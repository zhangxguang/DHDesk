import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridge,
  DesktopUpdateSnapshot,
  HarnessUpdateSnapshot,
  RuntimeSnapshot
} from "../shared/contracts";

// Sandboxed preload scripts cannot require arbitrary local modules. Keep the
// runtime channel literals self-contained and use the shared import for types only.
const IPC_CHANNELS = {
  runtimeState: "runtime:state",
  retryRuntime: "runtime:retry",
  openLogs: "diagnostics:open-logs",
  harnessUpdateState: "harness-update:state",
  checkHarnessUpdate: "harness-update:check",
  installHarnessUpdate: "harness-update:install",
  activateHarnessUpdate: "harness-update:activate",
  desktopUpdateState: "desktop-update:state",
  checkDesktopUpdate: "desktop-update:check",
  downloadDesktopUpdate: "desktop-update:download",
  installDesktopUpdate: "desktop-update:install"
} as const;

const bridge: DesktopBridge = {
  getRuntimeState: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeState) as Promise<RuntimeSnapshot>,
  retryRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.retryRuntime) as Promise<void>,
  openLogs: () => ipcRenderer.invoke(IPC_CHANNELS.openLogs) as Promise<void>,
  getHarnessUpdateState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.harnessUpdateState) as Promise<HarnessUpdateSnapshot>,
  checkHarnessUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.checkHarnessUpdate) as Promise<HarnessUpdateSnapshot>,
  installHarnessUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.installHarnessUpdate) as Promise<HarnessUpdateSnapshot>,
  activateHarnessUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.activateHarnessUpdate) as Promise<HarnessUpdateSnapshot>,
  getDesktopUpdateState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.desktopUpdateState) as Promise<DesktopUpdateSnapshot>,
  checkDesktopUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.checkDesktopUpdate) as Promise<DesktopUpdateSnapshot>,
  downloadDesktopUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.downloadDesktopUpdate) as Promise<DesktopUpdateSnapshot>,
  installDesktopUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installDesktopUpdate) as Promise<void>,
  onRuntimeState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: RuntimeSnapshot): void => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.runtimeState, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runtimeState, handler);
  },
  onHarnessUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: HarnessUpdateSnapshot): void => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.harnessUpdateState, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.harnessUpdateState, handler);
  },
  onDesktopUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DesktopUpdateSnapshot): void => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.desktopUpdateState, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.desktopUpdateState, handler);
  }
};

contextBridge.exposeInMainWorld("dhdesk", bridge);
