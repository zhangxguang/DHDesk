import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const releaseDirectory = resolve(process.env.DHDESK_RELEASE_DIR ?? join(projectRoot, "release"));
const packageMetadata = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const version = String(packageMetadata.version ?? "").trim();
if (!version) throw new Error("package.json does not contain a version.");

const metadataPath = join(releaseDirectory, "latest-mac.yml");
const existingMetadata = await readFile(metadataPath, "utf8");
const metadataVersion = existingMetadata.match(/^version:\s*['\"]?([^'\"\s]+)['\"]?\s*$/m)?.[1];
if (metadataVersion !== version) {
  throw new Error(`latest-mac.yml version '${metadataVersion ?? "missing"}' does not match '${version}'.`);
}

const entries = await readdir(releaseDirectory, { withFileTypes: true });
const zipNames = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".zip") && entry.name.includes(`-${version}-`))
  .map((entry) => entry.name);
if (zipNames.length !== 1) {
  throw new Error(`Expected exactly one macOS update ZIP for ${version}, found ${zipNames.length}.`);
}

const zipName = zipNames[0];
const zipPath = join(releaseDirectory, zipName);
const zipStat = await stat(zipPath);
const hash = createHash("sha512");
for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
const sha512 = hash.digest("base64");
const releaseDate = existingMetadata.match(/^releaseDate:\s*['\"]?([^'\"\r\n]+)['\"]?\s*$/m)?.[1]
  ?? new Date().toISOString();

// The DMG is signed and stapled after electron-builder writes latest-mac.yml,
// which changes its bytes. macOS auto-update uses the ZIP, so publish only the
// finalized ZIP in the feed and keep the DMG as a manual-install Release asset.
const finalizedMetadata = [
  `version: ${version}`,
  "files:",
  `  - url: ${basename(zipName)}`,
  `    sha512: ${sha512}`,
  `    size: ${zipStat.size}`,
  `path: ${basename(zipName)}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ""
].join("\n");

const temporaryPath = `${metadataPath}.tmp`;
await writeFile(temporaryPath, finalizedMetadata, "utf8");
await rename(temporaryPath, metadataPath);
process.stdout.write(`Finalized ${metadataPath} with ${zipName}\n`);
