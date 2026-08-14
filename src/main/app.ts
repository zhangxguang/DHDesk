import { app, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { autoUpdater } from "electron-updater";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeSnapshot } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/contracts";
import { confirmActiveRuntime, rollbackActiveRuntime } from "./active-runtime";
import { DesktopUpdater } from "./desktop-updater";
import { HarnessUpdater } from "./harness-updater";
import { RuntimeLogger } from "./logging";
import { ensureRuntimePlatformMetadata } from "./runtime-metadata";
import { HarnessProcessSupervisor } from "./process-supervisor";
import {
  inspectNodeRuntime,
  locateHarnessRuntime,
  locateNodeRuntime,
  locateNpmCli,
  type NodeRuntimeIdentity,
  type RuntimeInstallation
} from "./runtime-locator";
import { WindowManager } from "./window-manager";

app.setName("DHDesk");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  void bootstrap();
}

let windowManager: WindowManager;
let supervisor: HarnessProcessSupervisor | undefined;
let updater: HarnessUpdater | undefined;
let desktopUpdater: DesktopUpdater;
let logger: RuntimeLogger;
let isQuitting = false;
let currentState: RuntimeSnapshot = { phase: "idle", message: "准备启动" };

async function bootstrap(): Promise<void> {
  await app.whenReady();

  logger = new RuntimeLogger(join(app.getPath("logs"), "harness.log"));
  windowManager = new WindowManager();
  desktopUpdater = new DesktopUpdater({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    client: autoUpdater,
    logger
  });
  desktopUpdater.on("state", (snapshot) => windowManager.publishDesktopUpdateState(snapshot));
  registerIpc();
  registerLifecycle();
  registerApplicationMenu();
  await startHarness();
}

async function startHarness(options: { allowPendingRollback?: boolean } = {}): Promise<RuntimeInstallation | undefined> {
  if (supervisor) await supervisor.stop();

  setState({ phase: "locating", message: "正在检查本地 Runtime" });
  await windowManager.showStartup();
  let runtime: RuntimeInstallation | undefined;

  try {
    const appRoot = app.getAppPath();
    const resourcesPath = process.resourcesPath;
    const node = await locateNodeRuntime({
      appRoot,
      resourcesPath,
      executableOverride: process.env.DHDESK_NODE_PATH,
      electronExecutable: process.execPath,
      isElectron: Boolean(process.versions.electron)
    });
    const nodeIdentity = await inspectNodeRuntime(node);
    runtime = await locateHarnessRuntime({
      appRoot,
      resourcesPath,
      userDataPath: app.getPath("userData"),
      entryOverride: process.env.DHDESK_DSH_ENTRY,
      platform: nodeIdentity.platform,
      arch: nodeIdentity.arch,
      nodeVersion: nodeIdentity.version
    });
    await ensureUpdater(runtime, node.executablePath, nodeIdentity, appRoot, resourcesPath);

    await logger.info(`Resolved Harness ${runtime.version} from ${runtime.source}: ${runtime.entryPath}`);
    supervisor = new HarnessProcessSupervisor({
      nodeExecutable: node.executablePath,
      electronAsNode: node.electronAsNode,
      dshEntry: runtime.entryPath,
      version: runtime.version,
      cwd: homedir(),
      dshHome: process.env.DHDESK_DSH_HOME,
      logger
    });
    let startupComplete = false;
    supervisor.on("state", (snapshot: RuntimeSnapshot) => {
      setState(snapshot);
      if (snapshot.phase === "failed" && startupComplete) void windowManager.showStartup();
    });

    const running = await supervisor.start();
    startupComplete = true;
    const startupHoldMs = Number(process.env.DHDESK_STARTUP_HOLD_MS ?? "0");
    if (!app.isPackaged && Number.isFinite(startupHoldMs) && startupHoldMs > 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(startupHoldMs, 30_000)));
    }
    if (running.url) await windowManager.loadHarness(running.url);
    if (runtime.source === "managed" && runtime.metadataMissing) {
      await ensureRuntimePlatformMetadata(runtime.rootPath, {
        platform: nodeIdentity.platform,
        arch: nodeIdentity.arch,
        nodeVersion: nodeIdentity.version,
        harnessVersion: runtime.version
      });
      runtime = { ...runtime, metadataMissing: false };
      await logger.info(`Added missing platform metadata for managed Harness runtime ${runtime.version}`);
    }
    if (runtime.source === "managed" && runtime.pendingValidation) {
      await confirmActiveRuntime(app.getPath("userData"), runtime.version);
      runtime = { ...runtime, pendingValidation: false };
      await logger.info(`Confirmed managed Harness runtime ${runtime.version}`);
    }
    updater?.setCurrentRuntime(runtime);
    return runtime;
  } catch (error) {
    const details = error instanceof Error ? error.message : "发生未知启动错误。";
    await logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    if (runtime?.source === "managed" && runtime.pendingValidation && options.allowPendingRollback !== false) {
      const failedVersion = runtime.version;
      const restoredVersion = await rollbackActiveRuntime(app.getPath("userData"));
      await logger.error(
        `Managed Harness ${failedVersion} failed validation; rolling back to ${restoredVersion ?? "bundled runtime"}`
      );
      const restored = await startHarness({ allowPendingRollback: false });
      updater?.markActivationFailed(failedVersion, details);
      return restored;
    }
    setState({ phase: "failed", message: "DeepSeek Harness 启动失败", details });
    return undefined;
  }
}

async function ensureUpdater(
  runtime: RuntimeInstallation,
  nodeExecutable: string,
  nodeIdentity: NodeRuntimeIdentity,
  appRoot: string,
  resourcesPath: string
): Promise<void> {
  if (updater) return;
  const npmCliPath = await locateNpmCli({ appRoot, resourcesPath });
  updater = new HarnessUpdater({
    userDataPath: app.getPath("userData"),
    nodeExecutable,
    npmCliPath,
    nodeIdentity,
    currentRuntime: runtime,
    logger,
    registryUrl: process.env.DHDESK_NPM_REGISTRY
  });
  updater.on("state", (snapshot) => windowManager.publishUpdateState(snapshot));
}

function setState(snapshot: RuntimeSnapshot): void {
  currentState = snapshot;
  windowManager?.publishState(snapshot);
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.runtimeState, (event) => {
    assertStartupPage(event.senderFrame?.url);
    return currentState;
  });
  ipcMain.handle(IPC_CHANNELS.retryRuntime, async (event) => {
    assertStartupPage(event.senderFrame?.url);
    await startHarness();
  });
  ipcMain.handle(IPC_CHANNELS.openLogs, async (event) => {
    assertLocalPage(event.senderFrame?.url, ["startup.html", "updater.html", "app-updater.html"]);
    await shell.openPath(app.getPath("logs"));
  });
  ipcMain.handle(IPC_CHANNELS.harnessUpdateState, (event) => {
    assertUpdaterPage(event.senderFrame?.url);
    return requireUpdater().state;
  });
  ipcMain.handle(IPC_CHANNELS.checkHarnessUpdate, async (event) => {
    assertUpdaterPage(event.senderFrame?.url);
    return requireUpdater().checkForUpdates();
  });
  ipcMain.handle(IPC_CHANNELS.installHarnessUpdate, async (event) => {
    assertUpdaterPage(event.senderFrame?.url);
    return requireUpdater().installUpdate();
  });
  ipcMain.handle(IPC_CHANNELS.activateHarnessUpdate, async (event) => {
    assertUpdaterPage(event.senderFrame?.url);
    const manager = requireUpdater();
    const targetVersion = await manager.activateInstalledVersion();
    const running = await startHarness();
    if (running?.version !== targetVersion && manager.state.phase !== "failed") {
      manager.markActivationFailed(targetVersion, currentState.details ?? "目标版本未能启动。");
    }
    return manager.state;
  });
  ipcMain.handle(IPC_CHANNELS.desktopUpdateState, (event) => {
    assertDesktopUpdaterPage(event.senderFrame?.url);
    return desktopUpdater.state;
  });
  ipcMain.handle(IPC_CHANNELS.checkDesktopUpdate, async (event) => {
    assertDesktopUpdaterPage(event.senderFrame?.url);
    return desktopUpdater.checkForUpdates();
  });
  ipcMain.handle(IPC_CHANNELS.downloadDesktopUpdate, async (event) => {
    assertDesktopUpdaterPage(event.senderFrame?.url);
    return desktopUpdater.downloadUpdate();
  });
  ipcMain.handle(IPC_CHANNELS.installDesktopUpdate, async (event) => {
    assertDesktopUpdaterPage(event.senderFrame?.url);
    if (desktopUpdater.state.phase !== "downloaded") throw new Error("DHDesk 更新尚未下载完成。");
    await shutdown();
    isQuitting = true;
    windowManager.prepareToQuit();
    desktopUpdater.quitAndInstall();
  });
}

function registerApplicationMenu(): void {
  const harnessMenu: MenuItemConstructorOptions = {
    label: "Harness",
    submenu: [
      {
        label: "检查 Harness 更新…",
        accelerator: "CommandOrControl+Shift+U",
        click: () => void windowManager.showUpdater()
      },
      {
        label: "重新启动 Harness",
        click: () => void startHarness()
      },
      { type: "separator" },
      {
        label: "打开日志目录",
        click: () => void shell.openPath(app.getPath("logs"))
      }
    ]
  };
  const template: MenuItemConstructorOptions[] = process.platform === "darwin"
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            {
              label: "检查 DHDesk 更新…",
              accelerator: "CommandOrControl+Alt+U",
              click: () => void windowManager.showDesktopUpdater()
            },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        },
        harnessMenu,
        { role: "editMenu" },
        { role: "windowMenu" }
      ]
    : [
        {
          label: "文件",
          submenu: [{ role: "quit", label: "退出" }]
        },
        harnessMenu,
        { role: "editMenu" },
        { role: "windowMenu" },
        {
          label: "帮助",
          submenu: [
            {
              label: "检查 DHDesk 更新…",
              accelerator: "CommandOrControl+Alt+U",
              click: () => void windowManager.showDesktopUpdater()
            }
          ]
        }
      ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerLifecycle(): void {
  app.on("second-instance", () => windowManager.focus());
  app.on("activate", () => windowManager.focus());
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    windowManager.prepareToQuit();
    void shutdown().finally(() => {
      app.removeAllListeners("before-quit");
      app.quit();
    });
  });
}

async function shutdown(): Promise<void> {
  await supervisor?.stop().catch(async (error: unknown) => {
    await logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
  });
}

function assertStartupPage(url: string | undefined): void {
  assertLocalPage(url, ["startup.html"]);
}

function assertUpdaterPage(url: string | undefined): void {
  assertLocalPage(url, ["updater.html"]);
}

function assertDesktopUpdaterPage(url: string | undefined): void {
  assertLocalPage(url, ["app-updater.html"]);
}

function assertLocalPage(url: string | undefined, allowedPages: string[]): void {
  const allowed = allowedPages.map((page) => pathToFileURL(join(__dirname, "../renderer", page)).href);
  if (!url || !allowed.includes(url)) throw new Error("This operation is not available from the current page.");
}

function requireUpdater(): HarnessUpdater {
  if (!updater) throw new Error("Harness 更新服务尚未准备完成。");
  return updater;
}
