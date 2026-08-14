import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimePlatformMetadata,
  readRuntimePlatformMetadata,
  requireRuntimePlatformMetadata,
  writeRuntimePlatformMetadata
} from "../src/main/runtime-metadata";
import {
  nodeArchiveDirectory,
  nodeArchiveName,
  resolveRuntimeLayout
} from "../src/main/runtime-platform";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("runtime platform layout", () => {
  it("maps macOS arm64 to the Node tarball layout", () => {
    const layout = resolveRuntimeLayout("darwin", "arm64");
    expect(layout.nodeExecutableParts).toEqual(["bin", "node"]);
    expect(layout.npmCliParts).toEqual(["lib", "node_modules", "npm", "bin", "npm-cli.js"]);
    expect(nodeArchiveName("v24.19.0", layout)).toBe("node-v24.19.0-darwin-arm64.tar.xz");
    expect(nodeArchiveDirectory("v24.19.0", layout)).toBe("node-v24.19.0-darwin-arm64");
  });

  it("maps Windows x64 to the official Node zip layout", () => {
    const layout = resolveRuntimeLayout("win32", "x64");
    expect(layout.nodeExecutableParts).toEqual(["node.exe"]);
    expect(layout.npmCliParts).toEqual(["node_modules", "npm", "bin", "npm-cli.js"]);
    expect(nodeArchiveName("v24.19.0", layout)).toBe("node-v24.19.0-win-x64.zip");
    expect(nodeArchiveDirectory("v24.19.0", layout)).toBe("node-v24.19.0-win-x64");
  });

  it("rejects unsupported platform and architecture pairs", () => {
    expect(() => resolveRuntimeLayout("darwin", "x64")).toThrow("仅支持 darwin-arm64 和 win32-x64");
    expect(() => resolveRuntimeLayout("win32", "arm64")).toThrow("仅支持 darwin-arm64 和 win32-x64");
    expect(() => resolveRuntimeLayout("linux", "x64")).toThrow("仅支持 darwin-arm64 和 win32-x64");
  });
});

describe("runtime platform metadata", () => {
  it("writes, reads and validates a marker", async () => {
    const root = await makeTemporaryRoot();
    const metadata = createRuntimePlatformMetadata({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v24.19.0",
      harnessVersion: "0.1.0-rc.6"
    });
    await writeRuntimePlatformMetadata(root, metadata);

    await expect(readRuntimePlatformMetadata(root)).resolves.toEqual(metadata);
    await expect(
      requireRuntimePlatformMetadata(root, {
        platform: "darwin",
        arch: "arm64",
        nodeVersion: "v24.19.0",
        harnessVersion: "0.1.0-rc.6"
      })
    ).resolves.toEqual(metadata);
  });

  it("distinguishes missing, invalid and mismatched markers", async () => {
    const root = await makeTemporaryRoot();
    await expect(
      requireRuntimePlatformMetadata(root, { platform: "darwin", arch: "arm64" })
    ).rejects.toMatchObject({ reason: "missing" });

    await writeFile(join(root, "runtime-platform.json"), "{invalid json");
    await expect(readRuntimePlatformMetadata(root)).rejects.toMatchObject({ reason: "invalid" });

    await writeRuntimePlatformMetadata(
      root,
      createRuntimePlatformMetadata({
        platform: "win32",
        arch: "x64",
        nodeVersion: "v24.19.0",
        harnessVersion: "0.1.0-rc.6"
      })
    );
    await expect(
      requireRuntimePlatformMetadata(root, { platform: "darwin", arch: "arm64" })
    ).rejects.toMatchObject({ reason: "mismatch" });
  });

  it("rejects Node.js and Harness version mismatches", async () => {
    const root = await makeTemporaryRoot();
    await writeRuntimePlatformMetadata(
      root,
      createRuntimePlatformMetadata({
        platform: process.platform,
        arch: process.arch,
        nodeVersion: "v24.19.0",
        harnessVersion: "0.1.0-rc.6"
      })
    );

    await expect(
      requireRuntimePlatformMetadata(root, {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: "v24.20.0"
      })
    ).rejects.toMatchObject({ reason: "mismatch" });
    await expect(
      requireRuntimePlatformMetadata(root, {
        platform: process.platform,
        arch: process.arch,
        harnessVersion: "0.1.0"
      })
    ).rejects.toMatchObject({ reason: "mismatch" });
  });
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dhdesk-runtime-platform-"));
  temporaryDirectories.push(root);
  return root;
}
