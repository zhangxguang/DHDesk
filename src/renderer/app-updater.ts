type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "disabled"
  | "failed";

interface DesktopUpdateSnapshot {
  phase: DesktopUpdatePhase;
  message: string;
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  details?: string;
}

interface DesktopUpdateBridge {
  getDesktopUpdateState(): Promise<DesktopUpdateSnapshot>;
  checkDesktopUpdate(): Promise<DesktopUpdateSnapshot>;
  downloadDesktopUpdate(): Promise<DesktopUpdateSnapshot>;
  installDesktopUpdate(): Promise<void>;
  openLogs(): Promise<void>;
  onDesktopUpdateState(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
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
const bridge = window.dhdesk as unknown as DesktopUpdateBridge;

let snapshot: DesktopUpdateSnapshot = {
  phase: "idle",
  message: "可以检查 DHDesk 更新",
  currentVersion: "—"
};

actionButton.addEventListener("click", () => void performPrimaryAction());
checkButton.addEventListener("click", () => void runOperation(() => bridge.checkDesktopUpdate()));
logsButton.addEventListener("click", () => void bridge.openLogs());
bridge.onDesktopUpdateState(render);
void bridge.getDesktopUpdateState().then(render).catch((error: unknown) => {
  render({
    phase: "failed",
    message: "DHDesk 更新服务尚未准备完成",
    currentVersion: "—",
    details: error instanceof Error ? error.message : String(error)
  });
});

async function performPrimaryAction(): Promise<void> {
  switch (snapshot.phase) {
    case "available":
      await runOperation(() => bridge.downloadDesktopUpdate());
      break;
    case "downloaded":
      setActionsDisabled(true);
      try {
        await bridge.installDesktopUpdate();
      } catch (error) {
        render({
          ...snapshot,
          phase: "failed",
          message: "安装 DHDesk 更新失败",
          details: error instanceof Error ? error.message : String(error)
        });
        setActionsDisabled(false);
      }
      break;
    case "failed":
      await runOperation(() =>
        snapshot.latestVersion ? bridge.downloadDesktopUpdate() : bridge.checkDesktopUpdate()
      );
      break;
    case "idle":
    case "up-to-date":
      await runOperation(() => bridge.checkDesktopUpdate());
      break;
    case "checking":
    case "downloading":
    case "installing":
    case "disabled":
      break;
  }
}

async function runOperation(operation: () => Promise<DesktopUpdateSnapshot>): Promise<void> {
  setActionsDisabled(true);
  try {
    render(await operation());
  } catch (error) {
    render({
      ...snapshot,
      phase: "failed",
      message: "DHDesk 更新操作失败",
      details: error instanceof Error ? error.message : String(error)
    });
  } finally {
    setActionsDisabled(false);
  }
}

function render(next: DesktopUpdateSnapshot): void {
  snapshot = next;
  const busy = ["checking", "downloading", "installing"].includes(next.phase);
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
  actionButton.disabled = busy || next.phase === "disabled";
  checkButton.hidden = !["available", "downloaded", "failed"].includes(next.phase);
  checkButton.disabled = busy;
}

function primaryLabel(state: DesktopUpdateSnapshot): string {
  switch (state.phase) {
    case "available":
      return `下载 ${state.latestVersion ?? "新版本"}`;
    case "downloaded":
      return "重启并安装";
    case "failed":
      return state.latestVersion ? "重新下载" : "重新检查";
    case "checking":
      return "正在检查…";
    case "downloading":
      return "正在下载…";
    case "installing":
      return "正在重启…";
    case "disabled":
      return "仅安装版可用";
    case "idle":
    case "up-to-date":
      return "检查更新";
  }
}

function phaseDetails(phase: DesktopUpdatePhase): string {
  switch (phase) {
    case "idle":
      return "检查更新不会中断当前正在运行的 Harness。";
    case "checking":
      return "正在读取公开 GitHub Release 的更新元数据。";
    case "up-to-date":
      return "当前安装的 DHDesk 无需更新。";
    case "available":
      return "下载会在后台进行，完成前不会修改当前应用。";
    case "downloading":
      return "更新包会按 Release 元数据中的 SHA-512 摘要进行校验。";
    case "downloaded":
      return "更新已验证。重启后会安装新版 DHDesk 并重新打开应用。";
    case "installing":
      return "DHDesk 正在安全停止 Harness，然后重启并安装更新。";
    case "disabled":
      return "开发模式不会读取发布更新，请安装正式构建后使用。";
    case "failed":
      return "当前 DHDesk 和 Harness 不受影响，可查看日志了解详细原因。";
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
