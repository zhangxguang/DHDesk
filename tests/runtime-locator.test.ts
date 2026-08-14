import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectNodeRuntime,
  locateHarnessRuntime,
  locateNodeRuntime,
  locateNpmCli
} from "../src/main/runtime-locator";
import {
  createRuntimePlatformMetadata,
  writeRuntimePlatformMetadata
} from "../src/main/runtime-metadata";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("locateHarnessRuntime", () => {
  it("prefers a managed active version over the bundled runtime", async () => {
    const root = await makeTemporaryRoot();
    const userDataPath = join(root, "user-data");
    const managedRoot = join(userDataPath, "runtimes", "1.2.3");
    await createRuntime(managedRoot, "1.2.3");
    await mkdir(userDataPath, { recursive: true });
    await writeFile(join(userDataPath, "active-runtime.json"), JSON.stringify({ version: "1.2.3" }));

    const runtime = await locateHarnessRuntime({
      appRoot: root,
      resourcesPath: join(root, "resources-path"),
      userDataPath
    });

    expect(runtime.source).toBe("managed");
    expect(runtime.version).toBe("1.2.3");
    expect(runtime.metadataMissing).toBe(true);
  });

  it("uses the development runtime when no installed runtime exists", async () => {
    const root = await makeTemporaryRoot();
    await createRuntime(join(root, "resources", "bundled-runtime"), "0.1.0-test.1", true);

    const runtime = await locateHarnessRuntime({
      appRoot: root,
      resourcesPath: join(root, "packaged-resources"),
      userDataPath: join(root, "user-data")
    });

    expect(runtime.source).toBe("development");
    expect(runtime.version).toBe("0.1.0-test.1");
  });

  it("rejects an active runtime for another platform and falls back to bundled", async () => {
    const root = await makeTemporaryRoot();
    const userDataPath = join(root, "user-data");
    const managedRoot = join(userDataPath, "runtimes", "1.2.3");
    const bundledRoot = join(root, "resources", "bundled-runtime");
    await createRuntime(managedRoot, "1.2.3", false);
    await writeRuntimePlatformMetadata(
      managedRoot,
      createRuntimePlatformMetadata({
        platform: process.platform === "darwin" ? "win32" : "darwin",
        arch: process.platform === "darwin" ? "x64" : "arm64",
        nodeVersion: "v24.19.0",
        harnessVersion: "1.2.3"
      })
    );
    await createRuntime(bundledRoot, "0.1.0-test.1", true);
    await mkdir(userDataPath, { recursive: true });
    await writeFile(join(userDataPath, "active-runtime.json"), JSON.stringify({ version: "1.2.3" }));

    const runtime = await locateHarnessRuntime({
      appRoot: root,
      resourcesPath: join(root, "packaged-resources"),
      userDataPath
    });

    expect(runtime.source).toBe("development");
    expect(runtime.version).toBe("0.1.0-test.1");
  });
});

describe("Node runtime location", () => {
  it("uses the Windows zip layout without invoking cmd files", async () => {
    const root = await makeTemporaryRoot();
    const nodePath = join(root, "resources", "node", "node.exe");
    const npmPath = join(root, "resources", "node", "node_modules", "npm", "bin", "npm-cli.js");
    await mkdir(join(npmPath, ".."), { recursive: true });
    await writeFile(nodePath, "fixture");
    await writeFile(npmPath, "fixture");

    await expect(
      locateNodeRuntime({
        appRoot: root,
        resourcesPath: join(root, "packaged-resources"),
        electronExecutable: "electron.exe",
        isElectron: false,
        platform: "win32",
        arch: "x64"
      })
    ).resolves.toEqual({ executablePath: nodePath, electronAsNode: false });
    await expect(
      locateNpmCli({
        appRoot: root,
        resourcesPath: join(root, "packaged-resources"),
        platform: "win32",
        arch: "x64"
      })
    ).resolves.toBe(npmPath);
  });

  it("inspects the platform, architecture and version of a Node executable", async () => {
    await expect(
      inspectNodeRuntime({ executablePath: process.execPath, electronAsNode: false })
    ).resolves.toMatchObject({ platform: process.platform, arch: process.arch, version: process.version });
  });
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dhdesk-test-"));
  temporaryDirectories.push(root);
  return root;
}

async function createRuntime(root: string, version: string, includeMarker = false): Promise<void> {
  const packageRoot = join(root, "node_modules", "@deepseek-ai", "dsh");
  await mkdir(join(packageRoot, "lib"), { recursive: true });
  await writeFile(join(packageRoot, "lib", "bin.js"), "// fixture\n");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version }));
  if (includeMarker) {
    await writeRuntimePlatformMetadata(
      root,
      createRuntimePlatformMetadata({
        platform: process.platform,
        arch: process.arch,
        nodeVersion: "v24.19.0",
        harnessVersion: version
      })
    );
  }
}
