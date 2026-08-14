import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateRuntime,
  confirmActiveRuntime,
  readActiveRuntime,
  rollbackActiveRuntime
} from "../src/main/active-runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("active runtime", () => {
  it("atomically records and confirms a new active version", async () => {
    const root = await makeTemporaryRoot();
    await activateRuntime(root, "0.2.0-rc.1", "0.1.0-rc.6");

    expect(await readActiveRuntime(root)).toMatchObject({
      version: "0.2.0-rc.1",
      previousVersion: "0.1.0-rc.6",
      pendingValidation: true
    });

    await confirmActiveRuntime(root, "0.2.0-rc.1");
    expect(await readActiveRuntime(root)).toMatchObject({
      version: "0.2.0-rc.1",
      pendingValidation: false
    });
  });

  it("rolls a pending activation back to the previous version", async () => {
    const root = await makeTemporaryRoot();
    await activateRuntime(root, "0.2.0", "0.1.0-rc.6");

    await expect(rollbackActiveRuntime(root)).resolves.toBe("0.1.0-rc.6");
    expect(await readActiveRuntime(root)).toMatchObject({
      version: "0.1.0-rc.6",
      pendingValidation: false
    });
  });

  it("rejects a version that could escape the runtimes directory", async () => {
    const root = await makeTemporaryRoot();
    await expect(activateRuntime(root, "../malicious")).rejects.toThrow("不安全");
  });
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dhdesk-active-runtime-"));
  temporaryDirectories.push(root);
  return root;
}
