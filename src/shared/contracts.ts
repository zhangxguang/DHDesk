export const IPC_CHANNELS = {
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

export type RuntimePhase = "idle" | "locating" | "starting" | "running" | "stopping" | "failed";

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  message: string;
  version?: string;
  url?: string;
  details?: string;
}

export type HarnessUpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "verifying"
  | "ready"
  | "activating"
  | "failed";

export interface HarnessUpdateSnapshot {
  phase: HarnessUpdatePhase;
  message: string;
  currentVersion: string;
  latestVersion?: string;
  installedVersion?: string;
  progress?: number;
  details?: string;
}

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "disabled"
  | "failed";

export interface DesktopUpdateSnapshot {
  phase: DesktopUpdatePhase;
  message: string;
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  details?: string;
}

export interface DesktopBridge {
  getRuntimeState(): Promise<RuntimeSnapshot>;
  retryRuntime(): Promise<void>;
  openLogs(): Promise<void>;
  getHarnessUpdateState(): Promise<HarnessUpdateSnapshot>;
  checkHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  installHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  activateHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  getDesktopUpdateState(): Promise<DesktopUpdateSnapshot>;
  checkDesktopUpdate(): Promise<DesktopUpdateSnapshot>;
  downloadDesktopUpdate(): Promise<DesktopUpdateSnapshot>;
  installDesktopUpdate(): Promise<void>;
  onRuntimeState(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  onHarnessUpdateState(listener: (snapshot: HarnessUpdateSnapshot) => void): () => void;
  onDesktopUpdateState(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
}
