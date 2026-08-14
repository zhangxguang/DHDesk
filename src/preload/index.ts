import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, RuntimeSnapshot } from "../shared/contracts";

// Sandboxed preload scripts cannot require arbitrary local modules. Keep the
// runtime channel literals self-contained and use the shared import for types only.
const IPC_CHANNELS = {
  runtimeState: "runtime:state",
  retryRuntime: "runtime:retry",
  openLogs: "diagnostics:open-logs"
} as const;

const bridge: DesktopBridge = {
  getRuntimeState: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeState) as Promise<RuntimeSnapshot>,
  retryRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.retryRuntime) as Promise<void>,
  openLogs: () => ipcRenderer.invoke(IPC_CHANNELS.openLogs) as Promise<void>,
  onRuntimeState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: RuntimeSnapshot): void => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.runtimeState, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runtimeState, handler);
  }
};

contextBridge.exposeInMainWorld("dhdesk", bridge);
