import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const releaseDirectory = resolve(import.meta.dirname, "..", "release");
const entries = await readdir(releaseDirectory, { withFileTypes: true });
const artifacts = entries
  .filter((entry) => entry.isFile() && /\.(?:dmg|exe)$/i.test(entry.name))
  .map((entry) => join(releaseDirectory, entry.name));

if (artifacts.length === 0) throw new Error(`No DMG or EXE artifacts were found in ${releaseDirectory}.`);

for (const artifact of artifacts) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  const destination = `${artifact}.sha256`;
  await writeFile(destination, `${hash.digest("hex")}  ${basename(artifact)}\n`, "utf8");
  process.stdout.write(`Wrote ${destination}\n`);
}
