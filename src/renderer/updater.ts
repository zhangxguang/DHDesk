type HarnessUpdatePhase =
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

interface HarnessUpdateSnapshot {
  phase: HarnessUpdatePhase;
  message: string;
  currentVersion: string;
  latestVersion?: string;
  installedVersion?: string;
  progress?: number;
  details?: string;
}

interface UpdateBridge {
  getHarnessUpdateState(): Promise<HarnessUpdateSnapshot>;
  checkHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  installHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  activateHarnessUpdate(): Promise<HarnessUpdateSnapshot>;
  openLogs(): Promise<void>;
  onHarnessUpdateState(listener: (snapshot: HarnessUpdateSnapshot) => void): () => void;
}

const currentVersion = requiredElement("current-version");
const latestVersion = requiredElement("latest-version");
const statusMessage = requiredElement("status-message");
const statusDetails = requiredElement("status-details");
const statusDot = requiredElement("status-dot");
const progressTrack = requiredElement("progress-track");
const progressBar = requiredElement("progress-bar");
const progressPercent = requiredElement("progress-percent");
const actionButton = requiredButton("action-button");
const checkButton = requiredButton("check-button");
const logsButton = requiredButton("logs-button");
const bridge = window.dhdesk as unknown as UpdateBridge;

let snapshot: HarnessUpdateSnapshot = {
  phase: "idle",
  message: "可以检查 DeepSeek Harness 更新",
  currentVersion: "—"
};

actionButton.addEventListener("click", () => void performPrimaryAction());
checkButton.addEventListener("click", () => void runOperation(() => bridge.checkHarnessUpdate()));
logsButton.addEventListener("click", () => void bridge.openLogs());
bridge.onHarnessUpdateState(render);
void bridge.getHarnessUpdateState().then(render).catch((error: unknown) => {
  render({
    phase: "failed",
    message: "更新服务尚未准备完成",
    currentVersion: "—",
    details: error instanceof Error ? error.message : String(error)
  });
});

async function performPrimaryAction(): Promise<void> {
  switch (snapshot.phase) {
    case "available":
      await runOperation(() => bridge.installHarnessUpdate());
      break;
    case "ready":
      await runOperation(() => bridge.activateHarnessUpdate());
      break;
    case "failed":
      if (snapshot.installedVersion) await runOperation(() => bridge.activateHarnessUpdate());
      else await runOperation(() => bridge.checkHarnessUpdate());
      break;
    case "idle":
    case "up-to-date":
      await runOperation(() => bridge.checkHarnessUpdate());
      break;
    case "checking":
    case "downloading":
    case "installing":
    case "verifying":
    case "activating":
      break;
  }
}

async function runOperation(operation: () => Promise<HarnessUpdateSnapshot>): Promise<void> {
  setActionsDisabled(true);
  try {
    render(await operation());
  } catch (error) {
    render({
      ...snapshot,
      phase: "failed",
      message: "Harness 更新操作失败",
      details: error instanceof Error ? error.message : String(error)
    });
  } finally {
    setActionsDisabled(false);
  }
}

function render(next: HarnessUpdateSnapshot): void {
  snapshot = next;
  const busy = ["checking", "downloading", "installing", "verifying", "activating"].includes(next.phase);
  const progress = next.progress;

  currentVersion.textContent = next.currentVersion;
  latestVersion.textContent = next.latestVersion ?? "尚未检查";
  statusMessage.textContent = next.message;
  statusDetails.textContent = next.details ?? phaseDetails(next.phase);
  statusDot.classList.toggle("busy", busy);
  statusDot.classList.toggle("failed", next.phase === "failed");

  progressTrack.hidden = progress === undefined;
  progressBar.style.width = `${Math.round((progress ?? 0) * 100)}%`;
  progressPercent.textContent = progress === undefined ? "" : `${Math.round(progress * 100)}%`;

  actionButton.textContent = primaryLabel(next);
  actionButton.disabled = busy;
  checkButton.hidden = !["available", "ready", "failed"].includes(next.phase);
  checkButton.disabled = busy;
}

function primaryLabel(state: HarnessUpdateSnapshot): string {
  switch (state.phase) {
    case "available":
      return "下载并验证";
    case "ready":
      return `重启并使用 ${state.installedVersion ?? "新版本"}`;
    case "failed":
      return state.installedVersion ? "再次尝试切换" : "重新检查";
    case "checking":
      return "正在检查…";
    case "downloading":
      return "正在下载…";
    case "installing":
      return "正在安装…";
    case "verifying":
      return "正在验证…";
    case "activating":
      return "正在重启…";
    case "idle":
    case "up-to-date":
      return "检查更新";
  }
}

function phaseDetails(phase: HarnessUpdatePhase): string {
  switch (phase) {
    case "idle":
      return "检查更新不会中断当前正在运行的 Harness。";
    case "checking":
      return "正在读取 @deepseek-ai/dsh 的 latest 发布信息。";
    case "up-to-date":
      return "无需下载或切换 Runtime。";
    case "available":
      return "下载和安装会在独立目录中完成，当前 Harness 将继续运行。";
    case "downloading":
      return "下载完成后会核对 npm Registry 提供的 SHA-512 integrity。";
    case "installing":
      return "正在使用 DHDesk 内置的 Node.js 与 npm 安装生产依赖。";
    case "verifying":
      return "正在执行版本检查、本地 Web 服务启动和 HTTP 健康检查。";
    case "ready":
      return "新版本已通过验证。切换操作会安全停止当前 Harness 并重启。";
    case "activating":
      return "如果目标版本无法启动，DHDesk 会自动恢复上一版本。";
    case "failed":
      return "当前 Harness 未受影响。可查看日志了解详细原因。";
  }
}

function setActionsDisabled(disabled: boolean): void {
  actionButton.disabled = disabled;
  checkButton.disabled = disabled;
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
