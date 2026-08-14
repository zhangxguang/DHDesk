import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DesktopUpdater, type DesktopUpdaterClient } from "../src/main/desktop-updater";

class FakeUpdaterClient extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  logger: DesktopUpdaterClient["logger"] = null;
  checkResult: { isUpdateAvailable: boolean; updateInfo: { version: string } } | null = null;
  downloadVersion = "0.2.0";
  checkCalls = 0;
  downloadCalls = 0;
  installCalls = 0;

  async checkForUpdates(): Promise<typeof this.checkResult> {
    this.checkCalls += 1;
    this.emit("checking-for-update");
    if (this.checkResult?.isUpdateAvailable) this.emit("update-available", this.checkResult.updateInfo);
    else this.emit("update-not-available", this.checkResult?.updateInfo ?? { version: "0.1.1" });
    return this.checkResult;
  }

  async downloadUpdate(): Promise<string[]> {
    this.downloadCalls += 1;
    this.emit("download-progress", { percent: 42 });
    this.emit("update-downloaded", { version: this.downloadVersion });
    return ["update.zip"];
  }

  quitAndInstall(): void {
    this.installCalls += 1;
  }
}

const logger = {
  info: vi.fn(async () => undefined),
  error: vi.fn(async () => undefined)
};

describe("DHDesk desktop updater", () => {
  it("disables checks for unpackaged development builds", async () => {
    const client = new FakeUpdaterClient();
    const updater = createUpdater(client, false);

    await expect(updater.checkForUpdates()).resolves.toMatchObject({ phase: "disabled" });
    expect(client.checkCalls).toBe(0);
  });

  it("configures manual stable updates and reports an available release", async () => {
    const client = new FakeUpdaterClient();
    client.checkResult = { isUpdateAvailable: true, updateInfo: { version: "0.2.0" } };
    const updater = createUpdater(client);

    await expect(updater.checkForUpdates()).resolves.toMatchObject({
      phase: "available",
      currentVersion: "0.1.1",
      latestVersion: "0.2.0"
    });
    expect(client.autoDownload).toBe(false);
    expect(client.autoInstallOnAppQuit).toBe(false);
    expect(client.allowPrerelease).toBe(false);
  });

  it("tracks download progress and only installs a downloaded update", async () => {
    const client = new FakeUpdaterClient();
    client.checkResult = { isUpdateAvailable: true, updateInfo: { version: "0.2.0" } };
    const updater = createUpdater(client);
    const states: string[] = [];
    updater.on("state", (state) => states.push(state.phase));

    expect(() => updater.quitAndInstall()).toThrow("尚未下载完成");
    await updater.checkForUpdates();
    await expect(updater.downloadUpdate()).resolves.toMatchObject({ phase: "downloaded", progress: 1 });
    updater.quitAndInstall();

    expect(states).toContain("downloading");
    expect(states).toContain("downloaded");
    expect(client.downloadCalls).toBe(1);
    expect(client.installCalls).toBe(1);
  });

  it("keeps the current installation intact when a check fails", async () => {
    const client = new FakeUpdaterClient();
    client.checkForUpdates = async () => {
      throw new Error("network unavailable");
    };
    const updater = createUpdater(client);

    await expect(updater.checkForUpdates()).resolves.toMatchObject({
      phase: "failed",
      currentVersion: "0.1.1",
      details: "network unavailable"
    });
  });
});

function createUpdater(client: FakeUpdaterClient, isPackaged = true): DesktopUpdater {
  return new DesktopUpdater({
    currentVersion: "0.1.1",
    isPackaged,
    client,
    logger
  });
}
