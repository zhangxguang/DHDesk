import { app, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeSnapshot } from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/contracts";
import { RuntimeLogger } from "./logging";
import { HarnessProcessSupervisor } from "./process-supervisor";
import { locateHarnessRuntime, locateNodeRuntime } from "./runtime-locator";
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
let logger: RuntimeLogger;
let isQuitting = false;
let currentState: RuntimeSnapshot = { phase: "idle", message: "准备启动" };

async function bootstrap(): Promise<void> {
  await app.whenReady();

  logger = new RuntimeLogger(join(app.getPath("logs"), "harness.log"));
  windowManager = new WindowManager();
  registerIpc();
  registerLifecycle();
  await startHarness();
}

async function startHarness(): Promise<void> {
  if (supervisor) await supervisor.stop();

  setState({ phase: "locating", message: "正在检查本地 Runtime" });
  await windowManager.showStartup();

  try {
    const appRoot = app.getAppPath();
    const resourcesPath = process.resourcesPath;
    const runtime = await locateHarnessRuntime({
      appRoot,
      resourcesPath,
      userDataPath: app.getPath("userData"),
      entryOverride: process.env.DHDESK_DSH_ENTRY
    });
    const node = await locateNodeRuntime({
      appRoot,
      resourcesPath,
      executableOverride: process.env.DHDESK_NODE_PATH,
      electronExecutable: process.execPath,
      isElectron: Boolean(process.versions.electron)
    });

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
    supervisor.on("state", (snapshot: RuntimeSnapshot) => {
      setState(snapshot);
      if (snapshot.phase === "failed") void windowManager.showStartup();
    });

    const running = await supervisor.start();
    const startupHoldMs = Number(process.env.DHDESK_STARTUP_HOLD_MS ?? "0");
    if (!app.isPackaged && Number.isFinite(startupHoldMs) && startupHoldMs > 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(startupHoldMs, 30_000)));
    }
    if (running.url) await windowManager.loadHarness(running.url);
  } catch (error) {
    const details = error instanceof Error ? error.message : "发生未知启动错误。";
    await logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    setState({ phase: "failed", message: "DeepSeek Harness 启动失败", details });
  }
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
    assertStartupPage(event.senderFrame?.url);
    await shell.openPath(app.getPath("logs"));
  });
}

function registerLifecycle(): void {
  app.on("second-instance", () => windowManager.focus());
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
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
  if (!url?.startsWith("file:") || !url.endsWith("/startup.html")) {
    throw new Error("This operation is available only from the DHDesk startup page.");
  }
}
