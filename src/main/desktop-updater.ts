import { EventEmitter } from "node:events";
import type { DesktopUpdateSnapshot } from "../shared/contracts";

interface UpdateInfoLike {
  version: string;
}

interface UpdateCheckResultLike {
  isUpdateAvailable: boolean;
  updateInfo: UpdateInfoLike;
}

interface ProgressInfoLike {
  percent: number;
}

interface UpdaterLoggerLike {
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
}

export interface DesktopUpdaterClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  logger: UpdaterLoggerLike | null;
  on(event: "checking-for-update", listener: () => void): this;
  on(event: "update-available" | "update-not-available", listener: (info: UpdateInfoLike) => void): this;
  on(event: "download-progress", listener: (info: ProgressInfoLike) => void): this;
  on(event: "update-downloaded", listener: (info: UpdateInfoLike) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  checkForUpdates(): Promise<UpdateCheckResultLike | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface DesktopUpdaterOptions {
  currentVersion: string;
  isPackaged: boolean;
  client: DesktopUpdaterClient;
  logger: {
    info(message: string): Promise<void> | void;
    error(message: string): Promise<void> | void;
  };
}

export class DesktopUpdater extends EventEmitter {
  private snapshot: DesktopUpdateSnapshot;
  private operation?: Promise<DesktopUpdateSnapshot>;

  constructor(private readonly options: DesktopUpdaterOptions) {
    super();
    this.snapshot = options.isPackaged
      ? {
          phase: "idle",
          message: "可以检查 DHDesk 更新",
          currentVersion: options.currentVersion
        }
      : {
          phase: "disabled",
          message: "开发模式不检查 DHDesk 更新",
          currentVersion: options.currentVersion,
          details: "请使用已打包安装的 DHDesk 测试应用更新。"
        };

    this.configureClient();
  }

  get state(): DesktopUpdateSnapshot {
    return { ...this.snapshot };
  }

  async checkForUpdates(): Promise<DesktopUpdateSnapshot> {
    if (!this.options.isPackaged) return this.state;
    return this.runExclusive(async () => {
      this.setState({
        phase: "checking",
        message: "正在检查 DHDesk 更新",
        currentVersion: this.options.currentVersion
      });

      try {
        const result = await this.options.client.checkForUpdates();
        if (this.snapshot.phase === "checking") {
          if (result?.isUpdateAvailable) {
            this.setAvailable(result.updateInfo.version);
          } else {
            this.setUpToDate(result?.updateInfo.version);
          }
        }
      } catch (error) {
        this.setFailed("检查 DHDesk 更新失败", error);
      }
      return this.state;
    });
  }

  async downloadUpdate(): Promise<DesktopUpdateSnapshot> {
    if (!this.options.isPackaged) return this.state;
    if (this.snapshot.phase !== "available" && this.snapshot.phase !== "failed") {
      return this.state;
    }

    return this.runExclusive(async () => {
      this.setState({
        ...this.snapshot,
        phase: "downloading",
        message: "正在下载 DHDesk 更新",
        progress: 0,
        details: undefined
      });
      try {
        await this.options.client.downloadUpdate();
        if (this.snapshot.phase === "downloading") {
          this.setState({
            ...this.snapshot,
            phase: "downloaded",
            message: "DHDesk 更新已下载",
            progress: 1
          });
        }
      } catch (error) {
        this.setFailed("下载 DHDesk 更新失败", error);
      }
      return this.state;
    });
  }

  quitAndInstall(): void {
    if (this.snapshot.phase !== "downloaded") {
      throw new Error("DHDesk 更新尚未下载完成。");
    }
    this.setState({ ...this.snapshot, phase: "installing", message: "正在重启并安装 DHDesk 更新" });
    this.options.client.quitAndInstall(false, true);
  }

  private configureClient(): void {
    const { client, logger } = this.options;
    client.autoDownload = false;
    client.autoInstallOnAppQuit = false;
    client.allowPrerelease = false;
    client.logger = {
      info: (message) => void logger.info(`[DHDesk updater] ${String(message)}`),
      warn: (message) => void logger.info(`[DHDesk updater] WARN ${String(message)}`),
      error: (message) => void logger.error(`[DHDesk updater] ${String(message)}`)
    };

    client.on("checking-for-update", () => {
      this.setState({
        phase: "checking",
        message: "正在检查 DHDesk 更新",
        currentVersion: this.options.currentVersion
      });
    });
    client.on("update-available", (info) => this.setAvailable(info.version));
    client.on("update-not-available", (info) => this.setUpToDate(info.version));
    client.on("download-progress", (info) => {
      const progress = Math.min(1, Math.max(0, info.percent / 100));
      this.setState({
        ...this.snapshot,
        phase: "downloading",
        message: "正在下载 DHDesk 更新",
        progress
      });
    });
    client.on("update-downloaded", (info) => {
      this.setState({
        phase: "downloaded",
        message: "DHDesk 更新已下载",
        currentVersion: this.options.currentVersion,
        latestVersion: info.version,
        progress: 1
      });
    });
    client.on("error", (error) => this.setFailed("DHDesk 更新失败", error));
  }

  private setAvailable(version: string): void {
    this.setState({
      phase: "available",
      message: `发现 DHDesk ${version}`,
      currentVersion: this.options.currentVersion,
      latestVersion: version
    });
  }

  private setUpToDate(version?: string): void {
    this.setState({
      phase: "up-to-date",
      message: "DHDesk 已是最新版本",
      currentVersion: this.options.currentVersion,
      latestVersion: version ?? this.options.currentVersion
    });
  }

  private setFailed(message: string, error: unknown): void {
    const details = error instanceof Error ? error.message : String(error);
    void this.options.logger.error(`[DHDesk updater] ${details}`);
    this.setState({
      ...this.snapshot,
      phase: "failed",
      message,
      details,
      progress: undefined
    });
  }

  private setState(snapshot: DesktopUpdateSnapshot): void {
    this.snapshot = snapshot;
    this.emit("state", this.state);
  }

  private runExclusive(operation: () => Promise<DesktopUpdateSnapshot>): Promise<DesktopUpdateSnapshot> {
    if (this.operation) return this.operation;
    this.operation = operation().finally(() => {
      this.operation = undefined;
    });
    return this.operation;
  }
}
