export const IPC_CHANNELS = {
  runtimeState: "runtime:state",
  retryRuntime: "runtime:retry",
  openLogs: "diagnostics:open-logs"
} as const;

export type RuntimePhase = "idle" | "locating" | "starting" | "running" | "stopping" | "failed";

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  message: string;
  version?: string;
  url?: string;
  details?: string;
}

export interface DesktopBridge {
  getRuntimeState(): Promise<RuntimeSnapshot>;
  retryRuntime(): Promise<void>;
  openLogs(): Promise<void>;
  onRuntimeState(listener: (snapshot: RuntimeSnapshot) => void): () => void;
}
