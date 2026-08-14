import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("macOS update metadata finalization", () => {
  it("publishes only the finalized ZIP with its actual SHA-512 and size", async () => {
    const root = await mkdtemp(join(tmpdir(), "dhdesk-mac-update-"));
    temporaryDirectories.push(root);
    const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { version: string };
    const zipName = `DHDesk-${packageMetadata.version}-arm64-mac.zip`;
    const zipContent = Buffer.from("signed and notarized DHDesk app archive");
    const expectedHash = createHash("sha512").update(zipContent).digest("base64");

    await writeFile(join(root, zipName), zipContent);
    await writeFile(
      join(root, "latest-mac.yml"),
      [
        `version: ${packageMetadata.version}`,
        "files:",
        `  - url: ${zipName}`,
        "    sha512: old-zip-hash",
        "    size: 1",
        `  - url: DHDesk-${packageMetadata.version}-mac-arm64.dmg`,
        "    sha512: stale-dmg-hash",
        "    size: 2",
        `path: ${zipName}`,
        "sha512: old-zip-hash",
        "releaseDate: '2026-08-14T00:00:00.000Z'",
        ""
      ].join("\n")
    );

    await execFileAsync(process.execPath, [resolve("scripts/finalize-mac-update-metadata.mjs")], {
      cwd: resolve("."),
      env: { ...process.env, DHDESK_RELEASE_DIR: root }
    });

    const finalized = await readFile(join(root, "latest-mac.yml"), "utf8");
    expect(finalized).toContain(`url: ${zipName}`);
    expect(finalized).toContain(`sha512: ${expectedHash}`);
    expect(finalized).toContain(`size: ${zipContent.length}`);
    expect(finalized).not.toContain(".dmg");
    expect(finalized).not.toContain("stale-dmg-hash");
  });
});
