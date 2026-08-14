import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { locateHarnessRuntime } from "../src/main/runtime-locator";

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
  });

  it("uses the development runtime when no installed runtime exists", async () => {
    const root = await makeTemporaryRoot();
    await createRuntime(join(root, "resources", "bundled-runtime"), "0.1.0-test.1");

    const runtime = await locateHarnessRuntime({
      appRoot: root,
      resourcesPath: join(root, "packaged-resources"),
      userDataPath: join(root, "user-data")
    });

    expect(runtime.source).toBe("development");
    expect(runtime.version).toBe("0.1.0-test.1");
  });
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dhdesk-test-"));
  temporaryDirectories.push(root);
  return root;
}

async function createRuntime(root: string, version: string): Promise<void> {
  const packageRoot = join(root, "node_modules", "@deepseek-ai", "dsh");
  await mkdir(join(packageRoot, "lib"), { recursive: true });
  await writeFile(join(packageRoot, "lib", "bin.js"), "// fixture\n");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version }));
}
