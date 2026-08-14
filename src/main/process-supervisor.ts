import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { RuntimeSnapshot } from "../shared/contracts";
import type { RuntimeLogger } from "./logging";
import { terminateProcessTree } from "./process-tree";

const DEFAULT_START_TIMEOUT_MS = 45_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export interface HarnessLaunchOptions {
  nodeExecutable: string;
  electronAsNode: boolean;
  dshEntry: string;
  version: string;
  cwd: string;
  logger: RuntimeLogger;
  dshHome?: string;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
}

export function parseHarnessUrl(line: string): string | undefined {
  const match = line.match(/\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/?\S*)\s*$/i);
  return match?.[1];
}

export class HarnessProcessSupervisor extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private snapshot: RuntimeSnapshot = { phase: "idle", message: "Harness 尚未启动" };
  private stopRequested = false;

  constructor(private readonly options: HarnessLaunchOptions) {
    super();
  }

  get state(): RuntimeSnapshot {
    return { ...this.snapshot };
  }

  async start(): Promise<RuntimeSnapshot> {
    if (this.child) {
      throw new Error("Harness 进程已经存在。");
    }

    this.stopRequested = false;
    this.setState({
      phase: "starting",
      message: "正在启动 DeepSeek Harness",
      version: this.options.version
    });

    const environment: NodeJS.ProcessEnv = { ...process.env };
    if (this.options.dshHome) environment.DSH_HOME = this.options.dshHome;
    if (this.options.electronAsNode) environment.ELECTRON_RUN_AS_NODE = "1";
    else delete environment.ELECTRON_RUN_AS_NODE;

    const child = spawn(
      this.options.nodeExecutable,
      [this.options.dshEntry, "web", "--host", "127.0.0.1", "--port", "0"],
      {
        cwd: this.options.cwd,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: process.platform === "win32"
      }
    );
    child.stdin.end();
    this.child = child;

    void this.options.logger.info(
      `Starting Harness ${this.options.version} with runtime ${this.options.nodeExecutable}`
    );

    return new Promise<RuntimeSnapshot>((resolvePromise, rejectPromise) => {
      let settled = false;
      let verifying = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error("Harness 启动超时，未获得可用的本地服务地址。");
        this.fail(error);
        void this.stopAfterStartupFailure().finally(() => rejectPromise(error));
      }, this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS);

      const rejectStartup = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.fail(error);
        rejectPromise(error);
        if (this.child) void this.stopAfterStartupFailure();
      };

      consumeLines(child.stdout, (line) => {
        void this.options.logger.info(`[stdout] ${line}`);
        const url = parseHarnessUrl(line);
        if (!url || verifying || settled) return;

        verifying = true;
        void waitForHttpReady(url, 10_000)
          .then(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            this.setState({
              phase: "running",
              message: "DeepSeek Harness 已就绪",
              version: this.options.version,
              url
            });
            resolvePromise(this.state);
          })
          .catch((error: unknown) => {
            rejectStartup(asError(error, "Harness Web UI 健康检查失败。"));
          });
      });

      consumeLines(child.stderr, (line) => {
        void this.options.logger.error(`[stderr] ${line}`);
      });

      child.once("error", (error) => rejectStartup(error));
      child.once("exit", (code, signal) => {
        this.child = undefined;
        const summary = `Harness exited with code ${String(code)} and signal ${String(signal)}`;
        void this.options.logger.info(summary);

        if (!settled) {
          rejectStartup(new Error(`Harness 在启动过程中退出（code=${String(code)}）。`));
          return;
        }

        if (this.stopRequested) {
          this.setState({ phase: "idle", message: "Harness 已停止", version: this.options.version });
        } else {
          this.fail(new Error(`Harness 意外退出（code=${String(code)}）。`));
        }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.setState({ phase: "idle", message: "Harness 已停止", version: this.options.version });
      return;
    }

    this.stopRequested = true;
    this.setState({ phase: "stopping", message: "正在安全停止 Harness", version: this.options.version });
    await terminateProcessTree(child, {
      gracefulTimeoutMs: this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      forceTimeoutMs: 1_000
    });
  }

  private fail(error: Error): void {
    void this.options.logger.error(error.stack ?? error.message);
    this.setState({
      phase: "failed",
      message: "DeepSeek Harness 启动失败",
      version: this.options.version,
      details: error.message
    });
  }

  private async stopAfterStartupFailure(): Promise<void> {
    try {
      await this.stop();
    } catch (error) {
      await this.options.logger.error(
        `Failed to terminate Harness after startup failure: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private setState(snapshot: RuntimeSnapshot): void {
    this.snapshot = snapshot;
    this.emit("state", this.state);
  }
}

function consumeLines(stream: NodeJS.ReadableStream, listener: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) listener(line);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) listener(buffer);
  });
}

async function waitForHttpReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
      if (response.status >= 200 && response.status < 400) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await delay(150);
  }

  throw asError(lastError, "Harness Web UI 未通过健康检查。");
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
