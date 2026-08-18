import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  nodeArchiveDirectory,
  nodeArchiveName,
  resolveRuntimeLayout
} from "./runtime-platform.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(projectRoot, "resources/runtime-manifest.json"), "utf8"));
const version = requireVersion(manifest.nodeVersion, "nodeVersion");
const layout = resolveRuntimeLayout(process.platform, process.arch);
const archiveName = nodeArchiveName(version, layout);
const baseUrl = `https://nodejs.org/dist/${version}`;
const target = join(projectRoot, "resources/node");
const existingNode = join(target, ...layout.nodeExecutableParts);
const npmCli = join(target, ...layout.npmCliParts);

if (await existingRuntimeIsValid()) {
  process.stdout.write(`Node runtime ${version} for ${layout.target} already exists at ${existingNode}\n`);
  process.exit(0);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "dhdesk-node-"));

try {
  const [archiveResponse, sumsResponse] = await Promise.all([
    fetch(`${baseUrl}/${archiveName}`),
    fetch(`${baseUrl}/SHASUMS256.txt`)
  ]);

  if (!archiveResponse.ok || !sumsResponse.ok) {
    throw new Error(
      `Unable to download Node.js ${version} for ${layout.target} ` +
        `(archive=${archiveResponse.status}, checksums=${sumsResponse.status}).`
    );
  }

  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const expected = findPublishedChecksum(await sumsResponse.text(), archiveName);
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${archiveName}.`);

  const archivePath = join(temporaryRoot, basename(archiveName));
  await writeFile(archivePath, archive, { mode: 0o600 });
  await extractArchive(archivePath, temporaryRoot);

  const extracted = join(temporaryRoot, nodeArchiveDirectory(version, layout));
  const extractedNode = join(extracted, ...layout.nodeExecutableParts);
  const extractedNpmCli = join(extracted, ...layout.npmCliParts);
  await Promise.all([access(extractedNode), access(extractedNpmCli)]);
  await verifyNodeIdentity(extractedNode);
  await verifyNpmCli(extractedNode, extractedNpmCli);

  await rm(target, { recursive: true, force: true });
  await cp(extracted, target, { recursive: true });
  if (layout.platform === "darwin") await repairNodeBinLinks(target);
  await Promise.all([access(existingNode), access(npmCli)]);
  await verifyNodeIdentity(existingNode);
  await verifyNpmCli(existingNode, npmCli);
  process.stdout.write(`Prepared Node.js ${version} for ${layout.target} at ${target}\n`);
} catch (error) {
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
  const details = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to prepare Node.js on build host ${process.platform}-${process.arch}: ${details}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function existingRuntimeIsValid() {
  try {
    await Promise.all([access(existingNode), access(npmCli)]);
    if (layout.platform === "darwin") await repairNodeBinLinks(target);
    await verifyNodeIdentity(existingNode);
    await verifyNpmCli(existingNode, npmCli);
    return true;
  } catch {
    return false;
  }
}

async function verifyNpmCli(nodeExecutable, npmCliPath) {
  const npmVersion = (await runCapture(nodeExecutable, [npmCliPath, "--version"])).trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(npmVersion)) {
    throw new Error(`npm self-check returned invalid version '${npmVersion || "empty"}'.`);
  }
}

async function verifyNodeIdentity(nodeExecutable) {
  const output = await runCapture(nodeExecutable, [
    "-p",
    "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})"
  ]);
  let identity;
  try {
    identity = JSON.parse(output.trim());
  } catch {
    throw new Error(`Node.js self-check returned invalid output from ${nodeExecutable}.`);
  }
  if (identity.platform !== layout.platform || identity.arch !== layout.arch || identity.version !== version) {
    throw new Error(
      `Node.js self-check mismatch: expected ${layout.target}/${version}, ` +
        `received ${identity.platform}-${identity.arch}/${identity.version}.`
    );
  }
}

async function extractArchive(archivePath, destination) {
  const args = layout.nodeArchiveFormat === "tar.xz"
    ? ["-xJf", archivePath, "-C", destination]
    : ["-xf", archivePath, "-C", destination];
  await run("tar", args);
}

async function repairNodeBinLinks(nodeRoot) {
  const links = {
    corepack: "../lib/node_modules/corepack/dist/corepack.js",
    npm: "../lib/node_modules/npm/bin/npm-cli.js",
    npx: "../lib/node_modules/npm/bin/npx-cli.js"
  };

  for (const [name, targetPath] of Object.entries(links)) {
    const linkPath = join(nodeRoot, "bin", name);
    await rm(linkPath, { force: true });
    await symlink(targetPath, linkPath);
  }
}

function findPublishedChecksum(sums, fileName) {
  const checksum = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === fileName)?.[0];
  if (!checksum || !/^[0-9a-f]{64}$/i.test(checksum)) {
    throw new Error(`Checksum for ${fileName} was not published by Node.js.`);
  }
  return checksum.toLowerCase();
}

function requireVersion(value, field) {
  if (typeof value !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value)) {
    throw new Error(`resources/runtime-manifest.json contains an invalid ${field}.`);
  }
  return value;
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: process.platform === "win32" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`${command} exited with code ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });
}
