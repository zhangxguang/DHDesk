import { BrowserWindow, shell } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { DesktopUpdateSnapshot, HarnessUpdateSnapshot, RuntimeSnapshot } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/contracts";
import { getWindowCloseBehavior } from "./window-behavior";

export class WindowManager {
  private window?: BrowserWindow;
  private updaterWindow?: BrowserWindow;
  private desktopUpdaterWindow?: BrowserWindow;
  private harnessOrigin?: string;
  private appQuitting = false;
  private snapshot: RuntimeSnapshot = { phase: "idle", message: "准备启动" };

  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const window = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 900,
      minHeight: 620,
      show: false,
      backgroundColor: "#0b0d12",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false
      }
    });
    this.window = window;

    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalWebUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (this.isAllowedNavigation(url)) return;
      event.preventDefault();
      if (isExternalWebUrl(url)) void shell.openExternal(url);
    });
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.webContents.on("dom-ready", () => {
      if (window.webContents.getURL().startsWith("file:")) this.publishState(this.snapshot);
    });
    window.on("close", (event) => {
      const behavior = getWindowCloseBehavior(process.platform, this.appQuitting);
      if (behavior === "close") return;
      event.preventDefault();
      if (behavior === "hide") window.hide();
      else window.minimize();
    });

    window.on("closed", () => {
      this.window = undefined;
      this.harnessOrigin = undefined;
    });

    return window;
  }

  async showStartup(): Promise<void> {
    const window = this.create();
    this.harnessOrigin = undefined;
    await window.loadFile(join(__dirname, "../renderer/startup.html"));
    this.publishState(this.snapshot);
  }

  async loadHarness(url: string): Promise<void> {
    const window = this.create();
    this.harnessOrigin = new URL(url).origin;
    await window.loadURL(url);
  }

  async showUpdater(): Promise<void> {
    if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
      this.updaterWindow.show();
      this.updaterWindow.focus();
      return;
    }

    const updaterPath = join(__dirname, "../renderer/updater.html");
    const updaterUrl = pathToFileURL(updaterPath).href;
    const updaterWindow = new BrowserWindow({
      width: 680,
      height: 720,
      minWidth: 620,
      minHeight: 650,
      parent: this.window,
      show: false,
      backgroundColor: "#0b0d12",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false
      }
    });
    this.updaterWindow = updaterWindow;
    if (process.platform === "darwin") updaterWindow.setWindowButtonVisibility(true);
    updaterWindow.setTitle("Harness 更新");
    updaterWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    updaterWindow.webContents.on("will-navigate", (event, url) => {
      if (url === updaterUrl) return;
      event.preventDefault();
    });
    updaterWindow.once("ready-to-show", () => updaterWindow.show());
    updaterWindow.on("closed", () => {
      this.updaterWindow = undefined;
    });
    await updaterWindow.loadFile(updaterPath);
  }

  async showDesktopUpdater(): Promise<void> {
    if (this.desktopUpdaterWindow && !this.desktopUpdaterWindow.isDestroyed()) {
      this.desktopUpdaterWindow.show();
      this.desktopUpdaterWindow.focus();
      return;
    }

    const updaterPath = join(__dirname, "../renderer/app-updater.html");
    const updaterUrl = pathToFileURL(updaterPath).href;
    const updaterWindow = new BrowserWindow({
      width: 680,
      height: 690,
      minWidth: 620,
      minHeight: 620,
      parent: this.window,
      show: false,
      backgroundColor: "#0b0d12",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false
      }
    });
    this.desktopUpdaterWindow = updaterWindow;
    if (process.platform === "darwin") updaterWindow.setWindowButtonVisibility(true);
    updaterWindow.setTitle("DHDesk 更新");
    updaterWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    updaterWindow.webContents.on("will-navigate", (event, url) => {
      if (url === updaterUrl) return;
      event.preventDefault();
    });
    updaterWindow.once("ready-to-show", () => updaterWindow.show());
    updaterWindow.on("closed", () => {
      this.desktopUpdaterWindow = undefined;
    });
    await updaterWindow.loadFile(updaterPath);
  }

  publishState(snapshot: RuntimeSnapshot): void {
    this.snapshot = snapshot;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.runtimeState, snapshot);
  }

  publishUpdateState(snapshot: HarnessUpdateSnapshot): void {
    const window = this.updaterWindow;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.harnessUpdateState, snapshot);
  }

  publishDesktopUpdateState(snapshot: DesktopUpdateSnapshot): void {
    const window = this.desktopUpdaterWindow;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.desktopUpdateState, snapshot);
  }

  getState(): RuntimeSnapshot {
    return { ...this.snapshot };
  }

  prepareToQuit(): void {
    this.appQuitting = true;
  }

  focus(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private isAllowedNavigation(url: string): boolean {
    if (url.startsWith(pathToFileURL(join(__dirname, "../renderer/startup.html")).href)) return true;
    if (!this.harnessOrigin) return false;
    try {
      return new URL(url).origin === this.harnessOrigin;
    } catch {
      return false;
    }
  }
}

function isExternalWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
