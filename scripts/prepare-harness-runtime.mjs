import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveRuntimeLayout } from "./runtime-platform.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(projectRoot, "resources/runtime-manifest.json"), "utf8"));
const nodeVersion = requireVersion(manifest.nodeVersion, "nodeVersion");
const harnessVersion = requireVersion(manifest.harnessVersion, "harnessVersion");
const layout = resolveRuntimeLayout(process.platform, process.arch);
const runtimeRoot = join(projectRoot, "resources/bundled-runtime");
const dshEntry = join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const nodeRoot = join(projectRoot, "resources/node");
const nodeExecutable = join(nodeRoot, ...layout.nodeExecutableParts);
const npmCli = join(nodeRoot, ...layout.npmCliParts);

await Promise.all([access(nodeExecutable), access(npmCli)]).catch(() => {
  throw new Error(
    `Bundled Node.js for ${layout.target} is missing. Run npm run runtime:prepare:node on the target platform first.`
  );
});
await verifyNodeIdentity();

if (await existingRuntimeIsValid()) {
  process.stdout.write(`Harness runtime ${harnessVersion} for ${layout.target} already exists at ${runtimeRoot}\n`);
  process.exit(0);
}

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await writeFile(
  join(runtimeRoot, "package.json"),
  `${JSON.stringify({
    private: true,
    name: "dhdesk-bundled-runtime",
    version: "0.0.0",
    allowScripts: {
      "@deepseek-ai/dsh-subprocess-local@0.1.0-rc.6": true,
      "@google/genai@1.52.0": true,
      "koffi@3.1.5": true,
      "node-pty@1.1.0": true,
      "protobufjs@7.6.5": true
    }
  }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 }
);

try {
  await runInherited(
    nodeExecutable,
    [
      npmCli,
      "install",
      "--save-exact",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--engine-strict",
      "--foreground-scripts",
      `@deepseek-ai/dsh@${harnessVersion}`
    ],
    runtimeRoot
  );
  await validateInstalledRuntime({ smokeTest: true, requireMarker: false });
  await writeRuntimeMarker();
  process.stdout.write(`Prepared DeepSeek Harness ${harnessVersion} for ${layout.target} at ${runtimeRoot}\n`);
} catch (error) {
  await rm(runtimeRoot, { recursive: true, force: true });
  throw error;
}

async function existingRuntimeIsValid() {
  try {
    await validateInstalledRuntime({ smokeTest: false, requireMarker: true });
    return true;
  } catch {
    return false;
  }
}

async function validateInstalledRuntime(options) {
  await access(dshEntry);
  const packageJson = JSON.parse(
    await readFile(join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8")
  );
  if (packageJson.version !== harnessVersion) {
    throw new Error(`Installed Harness version mismatch: expected ${harnessVersion}, received ${packageJson.version}.`);
  }

  const versionOutput = await runCapture(nodeExecutable, [dshEntry, "--version"], runtimeRoot);
  if (!versionOutput.split(/\s+/).includes(harnessVersion)) {
    throw new Error(`dsh --version did not report ${harnessVersion}.`);
  }
  await verifyNativeDependencies();
  if (options.requireMarker) await verifyRuntimeMarker();
  if (options.smokeTest) await smokeTestHarness();
}

async function verifyNativeDependencies() {
  const required = layout.platform === "darwin"
    ? [
        ["node_modules", "@img", "sharp-darwin-arm64"],
        ["node_modules", "@koromix", "koffi-darwin-arm64"],
        ["node_modules", "node-pty", "prebuilds", "darwin-arm64", "pty.node"]
      ]
    : [
        ["node_modules", "@img", "sharp-win32-x64"],
        ["node_modules", "@koromix", "koffi-win32-x64"],
        ["node_modules", "node-pty", "prebuilds", "win32-x64", "pty.node"]
      ];
  for (const parts of required) {
    const dependencyPath = join(runtimeRoot, ...parts);
    await access(dependencyPath).catch(() => {
      throw new Error(`Harness runtime is missing the ${layout.target} native dependency: ${parts.join("/")}`);
    });
  }
}

async function verifyNodeIdentity() {
  const output = await runCapture(
    nodeExecutable,
    ["-p", "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})"],
    projectRoot
  );
  const identity = JSON.parse(output.trim());
  if (identity.platform !== layout.platform || identity.arch !== layout.arch || identity.version !== nodeVersion) {
    throw new Error(
      `Bundled Node.js mismatch: expected ${layout.target}/${nodeVersion}, ` +
        `received ${identity.platform}-${identity.arch}/${identity.version}.`
    );
  }
}

async function writeRuntimeMarker() {
  await writeFile(
    join(runtimeRoot, "runtime-platform.json"),
    `${JSON.stringify({
      platform: layout.platform,
      arch: layout.arch,
      nodeVersion,
      harnessVersion
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

async function verifyRuntimeMarker() {
  const marker = JSON.parse(await readFile(join(runtimeRoot, "runtime-platform.json"), "utf8"));
  const mismatched =
    marker.platform !== layout.platform ||
    marker.arch !== layout.arch ||
    marker.nodeVersion !== nodeVersion ||
    marker.harnessVersion !== harnessVersion;
  if (mismatched) {
    throw new Error(
      `Harness runtime marker mismatch: expected ${layout.target}/${nodeVersion}/${harnessVersion}.`
    );
  }
}

async function smokeTestHarness() {
  const temporaryHome = await mkdtemp(join(tmpdir(), "dhdesk-harness-prepare-"));
  const child = spawn(nodeExecutable, [dshEntry, "web", "--host", "127.0.0.1", "--port", "0"], {
    cwd: runtimeRoot,
    env: { ...process.env, DSH_HOME: temporaryHome },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: process.platform === "win32"
  });
  let stdout = "";
  let stderr = "";
  try {
    const url = await waitForHarnessUrl(child, (chunk, source) => {
      if (source === "stdout") stdout = appendLimited(stdout, chunk);
      else stderr = appendLimited(stderr, chunk);
    });
    await waitForHttpReady(url, 10_000);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Harness Web smoke test failed: ${details}; stdout=${stdout.trim()}; stderr=${stderr.trim()}`);
  } finally {
    await terminateProcessTree(child);
    await rm(temporaryHome, { recursive: true, force: true });
  }
}

function waitForHarnessUrl(child, onOutput) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = "";
    const timer = setTimeout(() => rejectPromise(new Error("Timed out waiting for the Harness URL.")), 45_000);
    const finish = (callback, value) => {
      clearTimeout(timer);
      callback(value);
    };
    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      onOutput(value, "stdout");
      buffer += value;
      const match = buffer.match(/\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/?\S*)/i);
      if (match) finish(resolvePromise, match[1]);
    });
    child.stderr.on("data", (chunk) => onOutput(chunk.toString(), "stderr"));
    child.once("error", (error) => finish(rejectPromise, error));
    child.once("exit", (code) => finish(rejectPromise, new Error(`Harness exited before startup with code ${code}.`)));
  });
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
      if (response.status >= 200 && response.status < 400) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw lastError instanceof Error ? lastError : new Error("Harness health check timed out.");
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await runInherited("taskkill", ["/PID", String(child.pid), "/T", "/F"], projectRoot).catch(() => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function runInherited(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      windowsHide: process.platform === "win32"
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function runCapture(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString());
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`${command} exited with code ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });
}

function appendLimited(current, next) {
  const combined = current + next;
  return combined.length <= 16_000 ? combined : combined.slice(-16_000);
}

function requireVersion(value, field) {
  if (typeof value !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value)) {
    throw new Error(`resources/runtime-manifest.json contains an invalid ${field}.`);
  }
  return value;
}
