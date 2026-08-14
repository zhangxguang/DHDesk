export const IPC_CHANNELS = {
  runtimeState: "runtime:state",
  retryRuntime: "runtime:retry",
  openLogs: "diagnostics:open-logs",
  harnessUpdateState: "harness-update:state",
  checkHarnessUpdate: "harness-update:check",
  installHarnessUpdate: "harness-update:install",
  activateHarnessUpdate: "harness-update:activate"
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

export interface DesktopBridge {
  getRuntimeState(): Promise<RuntimeSnapshot>;
  retryRuntime(): Promise<void>;
  openLogs(): Promise<void>;
  getHarnessUpdateState(): Promise<HarnessUpdateSnapshot>;
  checkHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  installHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  activateHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  onRuntimeState(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  onHarnessUpdateState(listener: (snapshot: HarnessUpdateSnapshot) => void): () => void;
}
