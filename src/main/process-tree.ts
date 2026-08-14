import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_GRACEFUL_TIMEOUT_MS = 5_000;
const DEFAULT_FORCE_TIMEOUT_MS = 2_000;

export interface TerminateProcessTreeOptions {
  platform?: string;
  gracefulTimeoutMs?: number;
  forceTimeoutMs?: number;
}

export function buildWindowsTreeKillArgs(pid: number, force: boolean): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`无效的进程 PID：${pid}`);
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

export async function terminateProcessTree(
  child: ChildProcess,
  options: TerminateProcessTreeOptions = {}
): Promise<void> {
  if (!child.pid || hasExited(child)) return;
  const platform = options.platform ?? process.platform;
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;
  const forceTimeoutMs = options.forceTimeoutMs ?? DEFAULT_FORCE_TIMEOUT_MS;

  if (platform === "win32") {
    await requestWindowsTreeTermination(child, false);
  } else {
    signalUnixProcessGroup(child, "SIGTERM");
  }
  if (await waitForExit(child, gracefulTimeoutMs)) return;

  if (platform === "win32") {
    await requestWindowsTreeTermination(child, true);
  } else {
    signalUnixProcessGroup(child, "SIGKILL");
  }
  if (!(await waitForExit(child, forceTimeoutMs))) {
    throw new Error(`进程树 ${child.pid} 在强制终止后仍未退出。`);
  }
}

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolvePromise(false);
    }, Math.max(0, timeoutMs));
    const onExit = (): void => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    child.once("exit", onExit);
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function requestWindowsTreeTermination(child: ChildProcess, force: boolean): Promise<void> {
  if (!child.pid || hasExited(child)) return;
  try {
    await runTaskkill(buildWindowsTreeKillArgs(child.pid, force));
  } catch {
    if (!hasExited(child)) child.kill();
  }
}

function signalUnixProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || hasExited(child)) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function runTaskkill(args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("taskkill", args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`taskkill 执行失败（code=${String(code)}）。`));
    });
  });
}
