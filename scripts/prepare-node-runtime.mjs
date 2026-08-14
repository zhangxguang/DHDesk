import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(projectRoot, "resources/runtime-manifest.json"), "utf8"));
const version = manifest.nodeVersion;
const arch = process.arch;

if (process.platform !== "darwin" || !["arm64", "x64"].includes(arch)) {
  throw new Error(`Unsupported build host: ${process.platform}-${arch}. DHDesk currently targets macOS arm64.`);
}

const archiveName = `node-${version}-darwin-${arch}.tar.xz`;
const baseUrl = `https://nodejs.org/dist/${version}`;
const target = join(projectRoot, "resources/node");
const existingNode = join(target, "bin/node");

try {
  await access(existingNode);
  await repairNodeBinLinks(target);
  process.stdout.write(`Node runtime already exists at ${existingNode}\n`);
  process.exit(0);
} catch {
  // Continue with a verified download.
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "dhdesk-node-"));

try {
  const [archiveResponse, sumsResponse] = await Promise.all([
    fetch(`${baseUrl}/${archiveName}`),
    fetch(`${baseUrl}/SHASUMS256.txt`)
  ]);

  if (!archiveResponse.ok || !sumsResponse.ok) {
    throw new Error(`Unable to download Node.js ${version}.`);
  }

  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const sums = await sumsResponse.text();
  const expected = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === archiveName)?.[0];

  if (!expected) {
    throw new Error(`Checksum for ${archiveName} was not published by Node.js.`);
  }

  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${archiveName}.`);
  }

  const archivePath = join(temporaryRoot, basename(archiveName));
  await writeFile(archivePath, archive);
  await run("tar", ["-xJf", archivePath, "-C", temporaryRoot]);

  const extracted = join(temporaryRoot, `node-${version}-darwin-${arch}`);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(extracted, target, { recursive: true });
  await repairNodeBinLinks(target);
  process.stdout.write(`Prepared Node.js ${version} at ${target}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
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

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}
