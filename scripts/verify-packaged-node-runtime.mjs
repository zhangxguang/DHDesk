import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveRuntimeLayout } from "./runtime-platform.mjs";

const nodeRootArgument = process.argv[2];
if (!nodeRootArgument) {
  throw new Error("Usage: node scripts/verify-packaged-node-runtime.mjs <packaged-node-root>");
}

const layout = resolveRuntimeLayout(process.platform, process.arch);
const nodeRoot = resolve(nodeRootArgument);
const nodeExecutable = join(nodeRoot, ...layout.nodeExecutableParts);
const npmCli = join(nodeRoot, ...layout.npmCliParts);
const temporaryRoot = await mkdtemp(join(tmpdir(), "dhdesk-packaged-npm-"));

try {
  await Promise.all([access(nodeExecutable), access(npmCli)]);

  const npmVersion = (await runCapture(nodeExecutable, [npmCli, "--version"], nodeRoot)).trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(npmVersion)) {
    throw new Error(`Packaged npm returned invalid version '${npmVersion || "empty"}'.`);
  }

  const applicationRoot = join(temporaryRoot, "application");
  const dependencyRoot = join(temporaryRoot, "dependency");
  const cacheRoot = join(temporaryRoot, "npm-cache");
  await Promise.all([
    mkdir(applicationRoot, { recursive: true }),
    mkdir(dependencyRoot, { recursive: true }),
    mkdir(cacheRoot, { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      join(applicationRoot, "package.json"),
      `${JSON.stringify({
        name: "dhdesk-packaged-npm-smoke",
        version: "1.0.0",
        private: true,
        dependencies: { "dhdesk-npm-smoke-dependency": "file:../dependency" }
      }, null, 2)}\n`
    ),
    writeFile(
      join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        name: "dhdesk-npm-smoke-dependency",
        version: "1.0.0",
        main: "index.js",
        scripts: { install: "node install-smoke.cjs" }
      }, null, 2)}\n`
    ),
    writeFile(join(dependencyRoot, "index.js"), "module.exports = true;\n"),
    writeFile(
      join(dependencyRoot, "install-smoke.cjs"),
      'require("node:fs").writeFileSync("installed-by-node.txt", `${process.execPath}\\n`);\n'
    )
  ]);

  await runCapture(
    nodeExecutable,
    [
      npmCli,
      "install",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--cache",
      cacheRoot
    ],
    applicationRoot
  );
  const installedDependencyRoot = join(applicationRoot, "node_modules", "dhdesk-npm-smoke-dependency");
  await access(join(installedDependencyRoot, "package.json"));
  const lifecycleNode = (await readFile(join(installedDependencyRoot, "installed-by-node.txt"), "utf8")).trim();
  const [expectedNode, actualNode] = await Promise.all([realpath(nodeExecutable), realpath(lifecycleNode)]);
  const normalizePath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalizePath(actualNode) !== normalizePath(expectedNode)) {
    throw new Error(`npm lifecycle used '${lifecycleNode}' instead of packaged Node '${nodeExecutable}'.`);
  }
  process.stdout.write(`Verified packaged Node/npm Runtime at ${nodeRoot} (npm ${npmVersion}).\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function runCapture(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: createPackagedNodeEnvironment(command, args[0]),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise(stdout);
      else {
        rejectPromise(
          new Error(
            `Packaged npm command failed (code=${code ?? "null"}, signal=${signal ?? "null"}): ` +
              stderr.trim()
          )
        );
      }
    });
  });
}

function createPackagedNodeEnvironment(nodeExecutablePath, npmCliPath) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")
  );
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const systemPaths = process.platform === "win32"
    ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32"), process.env.SystemRoot ?? "C:\\Windows"]
    : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return {
    ...environment,
    [pathKey]: [dirname(nodeExecutablePath), ...systemPaths].join(process.platform === "win32" ? ";" : ":"),
    NODE: nodeExecutablePath,
    npm_node_execpath: nodeExecutablePath,
    npm_execpath: npmCliPath,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false"
  };
}
