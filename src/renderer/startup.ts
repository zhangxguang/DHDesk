type RuntimePhase = "idle" | "locating" | "starting" | "running" | "stopping" | "failed";

interface RuntimeSnapshot {
  phase: RuntimePhase;
  message: string;
  version?: string;
  details?: string;
}

interface DesktopBridge {
  getRuntimeState(): Promise<RuntimeSnapshot>;
  retryRuntime(): Promise<void>;
  openLogs(): Promise<void>;
  onRuntimeState(listener: (snapshot: RuntimeSnapshot) => void): () => void;
}

declare global {
  interface Window {
    dhdesk: DesktopBridge;
  }
}

const message = requiredElement("status-message");
const detail = requiredElement("status-detail");
const dot = requiredElement("status-dot");
const progress = requiredElement("progress");
const recovery = requiredElement("recovery");
const version = requiredElement("runtime-version");
const retryButton = requiredButton("retry-button");
const logsButton = requiredButton("logs-button");

retryButton.addEventListener("click", () => {
  retryButton.disabled = true;
  void window.dhdesk.retryRuntime().finally(() => {
    retryButton.disabled = false;
  });
});

logsButton.addEventListener("click", () => void window.dhdesk.openLogs());
window.dhdesk.onRuntimeState(render);
void window.dhdesk.getRuntimeState().then(render);

function render(snapshot: RuntimeSnapshot): void {
  const failed = snapshot.phase === "failed";
  message.textContent = snapshot.message;
  detail.textContent = snapshot.details ?? phaseDetail(snapshot.phase);
  version.textContent = snapshot.version ? `Harness ${snapshot.version}` : "Harness";
  dot.classList.toggle("failed", failed);
  progress.classList.toggle("failed", failed);
  recovery.hidden = !failed;
}

function phaseDetail(phase: RuntimePhase): string {
  switch (phase) {
    case "locating":
      return "正在验证内置 Node.js 与 Harness 版本。";
    case "starting":
      return "本地服务启动后会自动进入工作区。";
    case "running":
      return "正在打开工作区。";
    case "stopping":
      return "正在保存会话并关闭本地服务。";
    case "idle":
      return "本地服务尚未运行。";
    case "failed":
      return "可以重新启动，或打开日志查看详细信息。";
  }
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return element;
}

export {};
