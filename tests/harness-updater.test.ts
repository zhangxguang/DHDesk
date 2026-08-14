import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isNewerVersion,
  parseRegistryMetadata,
  verifyFileIntegrity
} from "../src/main/harness-updater";

const temporaryDirectories: string[] = [];
const validIntegrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Harness updater metadata", () => {
  it("parses official registry metadata with SHA-512 integrity", () => {
    const result = parseRegistryMetadata({
      name: "@deepseek-ai/dsh",
      version: "0.2.0-rc.1",
      dist: {
        integrity: validIntegrity,
        tarball: "https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.0-rc.1.tgz"
      }
    });

    expect(result.version).toBe("0.2.0-rc.1");
  });

  it("rejects unexpected packages and insecure tarball URLs", () => {
    expect(() =>
      parseRegistryMetadata({
        name: "not-dsh",
        version: "1.0.0",
        dist: { integrity: validIntegrity, tarball: "https://registry.npmjs.org/not-dsh.tgz" }
      })
    ).toThrow("非预期");
    expect(() =>
      parseRegistryMetadata({
        name: "@deepseek-ai/dsh",
        version: "1.0.0",
        dist: { integrity: validIntegrity, tarball: "http://registry.npmjs.org/dsh.tgz" }
      })
    ).toThrow("HTTPS");
  });

  it("rejects malformed SHA-512 digests", () => {
    expect(() =>
      parseRegistryMetadata({
        name: "@deepseek-ai/dsh",
        version: "1.0.0",
        dist: { integrity: "sha512-YWJj", tarball: "https://registry.npmjs.org/dsh.tgz" }
      })
    ).toThrow("SHA-512");
  });
});

describe("Harness updater version ordering", () => {
  it("orders prereleases before stable releases", () => {
    expect(isNewerVersion("0.1.0-rc.7", "0.1.0-rc.6")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0-rc.7")).toBe(true);
    expect(isNewerVersion("0.1.0-rc.5", "0.1.0-rc.6")).toBe(false);
    expect(isNewerVersion("0.1.0-rc.6", "0.1.0-rc.6")).toBe(false);
  });
});

describe("Harness updater integrity", () => {
  it("accepts a matching file and rejects a modified file", async () => {
    const root = await makeTemporaryRoot();
    const path = join(root, "dsh.tgz");
    const original = Buffer.from("verified Harness archive");
    const integrity = `sha512-${createHash("sha512").update(original).digest("base64")}`;
    await writeFile(path, original);

    await expect(verifyFileIntegrity(path, integrity)).resolves.toBeUndefined();
    await writeFile(path, Buffer.from("modified archive"));
    await expect(verifyFileIntegrity(path, integrity)).rejects.toThrow("不匹配");
  });
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dhdesk-updater-test-"));
  temporaryDirectories.push(root);
  return root;
}
