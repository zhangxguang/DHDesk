import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { spawn } from "node:child_process";
import type { HarnessUpdateSnapshot } from "../shared/contracts";
import { activateRuntime, assertSafeVersion } from "./active-runtime";
import type { RuntimeLogger } from "./logging";
import {
  ensureRuntimePlatformMetadata,
  requireRuntimePlatformMetadata,
  RuntimeMetadataError,
  type ExpectedRuntimeMetadata
} from "./runtime-metadata";
import { HarnessProcessSupervisor } from "./process-supervisor";
import { terminateProcessTree } from "./process-tree";
import type { NodeRuntimeIdentity, RuntimeInstallation } from "./runtime-locator";

const PACKAGE_NAME = "@deepseek-ai/dsh";
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const MAX_TARBALL_BYTES = 100 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 8 * 60 * 1_000;
const DSH_ENTRY_PATH = join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");

interface RegistryMetadata {
  version: string;
  integrity: string;
  tarballUrl: string;
}

export interface HarnessUpdaterOptions {
  userDataPath: string;
  nodeExecutable: string;
  npmCliPath: string;
  nodeIdentity: NodeRuntimeIdentity;
  currentRuntime: RuntimeInstallation;
  logger: RuntimeLogger;
  registryUrl?: string;
  fetchImpl?: typeof fetch;
  maxTarballBytes?: number;
  installTimeoutMs?: number;
}

export class HarnessUpdater extends EventEmitter {
  private snapshot: HarnessUpdateSnapshot;
  private metadata?: RegistryMetadata;
  private operation?: Promise<HarnessUpdateSnapshot>;
  private currentSource: RuntimeInstallation["source"];

  constructor(private readonly options: HarnessUpdaterOptions) {
    super();
    this.currentSource = options.currentRuntime.source;
    this.snapshot = {
      phase: "idle",
      message: "可以检查 DeepSeek Harness 更新",
      currentVersion: options.currentRuntime.version
    };
  }

  get state(): HarnessUpdateSnapshot {
    return { ...this.snapshot };
  }

  setCurrentRuntime(runtime: RuntimeInstallation): void {
    this.currentSource = runtime.source;
    this.snapshot = { ...this.snapshot, currentVersion: runtime.version };
    if (this.snapshot.installedVersion === runtime.version) {
      this.setState({
        phase: "up-to-date",
        message: `Harness ${runtime.version} 已启用`,
        currentVersion: runtime.version,
        latestVersion: this.snapshot.latestVersion
      });
    } else {
      this.emitState();
    }
  }

  checkForUpdates(): Promise<HarnessUpdateSnapshot> {
    return this.runExclusive(async () => {
      this.setState({
        phase: "checking",
        message: "正在查询 npm Registry",
        currentVersion: this.snapshot.currentVersion
      });

      try {
        const metadata = await fetchLatestMetadata(
          this.options.fetchImpl ?? fetch,
          this.options.registryUrl ?? DEFAULT_REGISTRY_URL
        );
        this.metadata = metadata;
        const updateAvailable = isNewerVersion(metadata.version, this.snapshot.currentVersion);
        const installed = await this.installedRuntimeIsCompatible(metadata.version);

        if (installed && updateAvailable) {
          this.setState({
            phase: "ready",
            message: `Harness ${metadata.version} 已安装，可以重启切换`,
            currentVersion: this.snapshot.currentVersion,
            latestVersion: metadata.version,
            installedVersion: metadata.version,
            progress: 1
          });
        } else if (updateAvailable) {
          this.setState({
            phase: "available",
            message: `发现 Harness ${metadata.version}`,
            currentVersion: this.snapshot.currentVersion,
            latestVersion: metadata.version
          });
        } else {
          this.setState({
            phase: "up-to-date",
            message: "当前已是最新版本",
            currentVersion: this.snapshot.currentVersion,
            latestVersion: metadata.version
          });
        }
      } catch (error) {
        this.fail(error, "检查 Harness 更新失败");
      }
      return this.state;
    });
  }

  installUpdate(): Promise<HarnessUpdateSnapshot> {
    return this.runExclusive(async () => {
      try {
        const metadata = this.metadata ?? (await fetchLatestMetadata(
          this.options.fetchImpl ?? fetch,
          this.options.registryUrl ?? DEFAULT_REGISTRY_URL
        ));
        this.metadata = metadata;
        if (!isNewerVersion(metadata.version, this.snapshot.currentVersion)) {
          this.setState({
            phase: "up-to-date",
            message: "当前已是最新版本",
            currentVersion: this.snapshot.currentVersion,
            latestVersion: metadata.version
          });
          return this.state;
        }

        await this.install(metadata);
      } catch (error) {
        this.fail(error, "安装 Harness 更新失败");
      }
      return this.state;
    });
  }

  async activateInstalledVersion(): Promise<string> {
    if (this.operation) throw new Error("Harness 更新操作正在进行，请稍候。");
    const version = this.snapshot.installedVersion;
    if (!version) throw new Error("没有等待启用的 Harness 版本。");
    await validateRuntime(this.runtimePath(version), version, this.options.nodeExecutable, this.options.logger, false);
    await this.ensureRuntimeMarker(this.runtimePath(version), version);

    const previousVersion = this.currentSource === "managed" ? this.snapshot.currentVersion : undefined;
    await activateRuntime(this.options.userDataPath, version, previousVersion);
    this.setState({
      ...this.snapshot,
      phase: "activating",
      message: `正在切换到 Harness ${version}`,
      progress: 1
    });
    return version;
  }

  markActivationFailed(targetVersion: string, details: string): void {
    this.setState({
      phase: "failed",
      message: `Harness ${targetVersion} 启动失败，已恢复上一版本`,
      currentVersion: this.snapshot.currentVersion,
      latestVersion: this.snapshot.latestVersion,
      installedVersion: targetVersion,
      details
    });
  }

  private async install(metadata: RegistryMetadata): Promise<void> {
    assertSafeVersion(metadata.version);
    const runtimesRoot = join(this.options.userDataPath, "runtimes");
    const finalPath = this.runtimePath(metadata.version);
    await mkdir(runtimesRoot, { recursive: true, mode: 0o700 });

    if (await runtimeExists(finalPath)) {
      try {
        await validateRuntime(finalPath, metadata.version, this.options.nodeExecutable, this.options.logger, true);
        await this.ensureRuntimeMarker(finalPath, metadata.version);
        this.ready(metadata.version);
        return;
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        await this.options.logger.error(
          `Discarding invalid managed Harness runtime ${metadata.version} before reinstall: ${details}`
        );
        await rm(finalPath, { recursive: true, force: true });
      }
    }

    const stagingPath = await mkdtemp(join(runtimesRoot, `.install-${metadata.version}-`));
    try {
      const tarballPath = join(stagingPath, "dsh.tgz");
      this.setState({
        phase: "downloading",
        message: `正在下载 Harness ${metadata.version}`,
        currentVersion: this.snapshot.currentVersion,
        latestVersion: metadata.version,
        progress: 0
      });
      await downloadVerifiedTarball({
        fetchImpl: this.options.fetchImpl ?? fetch,
        url: metadata.tarballUrl,
        integrity: metadata.integrity,
        destination: tarballPath,
        maxBytes: this.options.maxTarballBytes ?? MAX_TARBALL_BYTES,
        onProgress: (progress) => this.setProgress(progress * 0.55)
      });

      await writeFile(
        join(stagingPath, "package.json"),
        `${JSON.stringify({
          private: true,
          name: "dhdesk-managed-runtime",
          version: "0.0.0",
          dependencies: { [PACKAGE_NAME]: "file:./dsh.tgz" }
        }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );

      this.setState({
        ...this.snapshot,
        phase: "installing",
        message: "正在安装生产依赖",
        progress: 0.6
      });
      await runProcess(
        this.options.nodeExecutable,
        [
          this.options.npmCliPath,
          "install",
          "--omit=dev",
          "--no-audit",
          "--no-fund",
          "--engine-strict",
          "--foreground-scripts",
          `--registry=${this.options.registryUrl ?? DEFAULT_REGISTRY_URL}`
        ],
        {
          cwd: stagingPath,
          timeoutMs: this.options.installTimeoutMs ?? INSTALL_TIMEOUT_MS,
          environment: {
            ...createNodeRuntimeEnvironment(this.options.nodeExecutable, this.options.npmCliPath),
            npm_config_cache: join(this.options.userDataPath, "npm-cache"),
            npm_config_update_notifier: "false"
          }
        }
      );

      this.setState({
        ...this.snapshot,
        phase: "verifying",
        message: "正在隔离验证新版本",
        progress: 0.86
      });
      await validateRuntime(stagingPath, metadata.version, this.options.nodeExecutable, this.options.logger, true);
      await this.ensureRuntimeMarker(stagingPath, metadata.version);
      await requireRuntimePlatformMetadata(stagingPath, this.expectedRuntimeMetadata(metadata.version));
      await rename(stagingPath, finalPath);
      await this.options.logger.info(`Installed managed Harness runtime ${metadata.version} at ${finalPath}`);
      this.ready(metadata.version);
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true });
      throw error;
    }
  }

  private ready(version: string): void {
    this.setState({
      phase: "ready",
      message: `Harness ${version} 已验证，可以重启切换`,
      currentVersion: this.snapshot.currentVersion,
      latestVersion: version,
      installedVersion: version,
      progress: 1
    });
  }

  private runtimePath(version: string): string {
    assertSafeVersion(version);
    return join(this.options.userDataPath, "runtimes", version);
  }

  private expectedRuntimeMetadata(version: string): ExpectedRuntimeMetadata {
    return {
      platform: this.options.nodeIdentity.platform,
      arch: this.options.nodeIdentity.arch,
      nodeVersion: this.options.nodeIdentity.version,
      harnessVersion: version
    };
  }

  private async ensureRuntimeMarker(rootPath: string, version: string): Promise<void> {
    const result = await ensureRuntimePlatformMetadata(rootPath, this.expectedRuntimeMetadata(version));
    if (result.created) {
      await this.options.logger.info(`Added runtime platform metadata for managed Harness ${version}`);
    }
  }

  private async installedRuntimeIsCompatible(version: string): Promise<boolean> {
    const rootPath = this.runtimePath(version);
    if (!(await runtimeExists(rootPath))) return false;
    try {
      await requireRuntimePlatformMetadata(rootPath, this.expectedRuntimeMetadata(version));
      return true;
    } catch (error) {
      return error instanceof RuntimeMetadataError && error.reason === "missing";
    }
  }

  private setProgress(progress: number): void {
    this.setState({ ...this.snapshot, progress: Math.max(0, Math.min(1, progress)) });
  }

  private fail(error: unknown, message: string): void {
    const details = error instanceof Error ? error.message : String(error);
    void this.options.logger.error(`${message}: ${details}`);
    this.setState({ ...this.snapshot, phase: "failed", message, details, progress: undefined });
  }

  private setState(snapshot: HarnessUpdateSnapshot): void {
    this.snapshot = snapshot;
    this.emitState();
  }

  private emitState(): void {
    this.emit("state", this.state);
  }

  private runExclusive(operation: () => Promise<HarnessUpdateSnapshot>): Promise<HarnessUpdateSnapshot> {
    if (this.operation) return this.operation;
    this.operation = operation().finally(() => {
      this.operation = undefined;
    });
    return this.operation;
  }
}

export async function fetchLatestMetadata(fetchImpl: typeof fetch, registryUrl: string): Promise<RegistryMetadata> {
  const base = new URL(registryUrl);
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost") {
    throw new Error("Harness 更新 Registry 必须使用 HTTPS。");
  }
  const endpoint = new URL(`${encodeURIComponent(PACKAGE_NAME)}/latest`, ensureTrailingSlash(base));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(endpoint, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`npm Registry 返回 HTTP ${response.status}`);
    return parseRegistryMetadata(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export function parseRegistryMetadata(value: unknown): RegistryMetadata {
  const metadata = value as {
    name?: unknown;
    version?: unknown;
    dist?: { integrity?: unknown; tarball?: unknown };
  };
  if (metadata?.name !== PACKAGE_NAME) throw new Error("npm Registry 返回了非预期的软件包。");
  if (typeof metadata.version !== "string") throw new Error("npm Registry 未返回有效版本号。");
  assertSafeVersion(metadata.version);
  if (typeof metadata.dist?.integrity !== "string" || !getSha512Digest(metadata.dist.integrity)) {
    throw new Error("Harness 包缺少 SHA-512 integrity。");
  }
  if (typeof metadata.dist.tarball !== "string") throw new Error("Harness 包缺少下载地址。");
  const tarballUrl = new URL(metadata.dist.tarball);
  if (tarballUrl.protocol !== "https:") throw new Error("Harness 下载地址必须使用 HTTPS。");

  return { version: metadata.version, integrity: metadata.dist.integrity, tarballUrl: tarballUrl.href };
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseSemver(candidate);
  const currentParts = parseSemver(current);
  if (!candidateParts || !currentParts) return candidate !== current;
  return compareSemverParts(candidateParts, currentParts) > 0;
}

export async function verifyFileIntegrity(path: string, integrity: string): Promise<void> {
  const expected = getSha512Digest(integrity);
  if (!expected) throw new Error("不支持的 integrity 格式。");
  const file = await readFile(path);
  const actual = createHash("sha512").update(file).digest("base64");
  if (actual !== expected) throw new Error("Harness 下载文件的 SHA-512 integrity 不匹配。");
}

export function createNodeRuntimeEnvironment(
  nodeExecutable: string,
  npmCliPath: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const preferredPathKey = platform === "win32" ? "Path" : "PATH";
  const inheritedPath =
    baseEnvironment[preferredPathKey] ??
    Object.entries(baseEnvironment).find(([key]) => key.toLowerCase() === "path")?.[1];
  const separator = platform === "win32" ? ";" : ":";
  const nodeDirectory = platform === "win32" ? win32.dirname(nodeExecutable) : dirname(nodeExecutable);

  return {
    [preferredPathKey]: inheritedPath ? `${nodeDirectory}${separator}${inheritedPath}` : nodeDirectory,
    NODE: nodeExecutable,
    npm_node_execpath: nodeExecutable,
    npm_execpath: npmCliPath
  };
}

interface DownloadOptions {
  fetchImpl: typeof fetch;
  url: string;
  integrity: string;
  destination: string;
  maxBytes: number;
  onProgress: (progress: number) => void;
}

async function downloadVerifiedTarball(options: DownloadOptions): Promise<void> {
  const response = await options.fetchImpl(options.url, { redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`下载 Harness 失败（HTTP ${response.status}）。`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    throw new Error("Harness 下载文件超过允许的大小限制。");
  }

  const handle = await open(options.destination, "wx", 0o600);
  const reader = response.body.getReader();
  const hash = createHash("sha512");
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > options.maxBytes) throw new Error("Harness 下载文件超过允许的大小限制。");
      hash.update(value);
      await handle.write(value);
      options.onProgress(contentLength > 0 ? received / contentLength : Math.min(0.95, received / options.maxBytes));
    }
  } finally {
    await handle.close();
  }

  const expected = getSha512Digest(options.integrity);
  const actual = hash.digest("base64");
  if (!expected || actual !== expected) {
    await rm(options.destination, { force: true });
    throw new Error("Harness 下载文件的 SHA-512 integrity 不匹配。");
  }
  options.onProgress(1);
}

async function validateRuntime(
  rootPath: string,
  expectedVersion: string,
  nodeExecutable: string,
  logger: RuntimeLogger,
  smokeTest: boolean
): Promise<void> {
  const entryPath = join(rootPath, DSH_ENTRY_PATH);
  await access(entryPath);
  const packageJson = JSON.parse(
    await readFile(join(rootPath, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8")
  ) as { version?: unknown };
  if (packageJson.version !== expectedVersion) {
    throw new Error(`安装后的 Harness 版本不匹配（期望 ${expectedVersion}）。`);
  }

  const versionResult = await runProcess(nodeExecutable, [entryPath, "--version"], {
    cwd: rootPath,
    timeoutMs: 20_000
  });
  if (!versionResult.stdout.split(/\s+/).includes(expectedVersion)) {
    throw new Error("dsh --version 未返回目标版本。");
  }
  if (!smokeTest) return;

  const temporaryHome = await mkdtemp(join(tmpdir(), "dhdesk-harness-smoke-"));
  const supervisor = new HarnessProcessSupervisor({
    nodeExecutable,
    electronAsNode: false,
    dshEntry: entryPath,
    version: expectedVersion,
    cwd: rootPath,
    dshHome: temporaryHome,
    logger,
    startTimeoutMs: 45_000,
    stopTimeoutMs: 5_000
  });
  try {
    await supervisor.start();
  } finally {
    await supervisor.stop().catch(() => undefined);
    await rm(temporaryHome, { recursive: true, force: true });
  }
}

interface RunProcessOptions {
  cwd: string;
  timeoutMs: number;
  environment?: NodeJS.ProcessEnv;
}

interface RunProcessResult {
  stdout: string;
  stderr: string;
}

function runProcess(command: string, args: string[], options: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: mergeProcessEnvironment(options.environment),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString());
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child, { gracefulTimeoutMs: 2_000, forceTimeoutMs: 1_000 }).catch(
        rejectPromise
      );
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) rejectPromise(new Error(`命令执行超时（${options.timeoutMs}ms）。`));
      else if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`命令执行失败（code=${String(code)}, signal=${String(signal)}）：${stderr.trim()}`));
    });
  });
}

function mergeProcessEnvironment(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (key.toLowerCase() === "path") {
      for (const existingKey of Object.keys(environment)) {
        if (existingKey.toLowerCase() === "path") delete environment[existingKey];
      }
    }
    environment[key] = value;
  }
  return environment;
}

function appendLimited(current: string, next: string): string {
  const combined = current + next;
  return combined.length <= 16_000 ? combined : combined.slice(-16_000);
}

async function runtimeExists(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, DSH_ENTRY_PATH))).isFile();
  } catch {
    return false;
  }
}

function ensureTrailingSlash(url: URL): URL {
  const value = new URL(url);
  if (!value.pathname.endsWith("/")) value.pathname += "/";
  return value;
}

function getSha512Digest(integrity: string): string | undefined {
  const digest = integrity
    .split(/\s+/)
    .find((entry) => entry.startsWith("sha512-"))
    ?.slice("sha512-".length);
  if (!digest) return undefined;

  try {
    return Buffer.from(digest, "base64").byteLength === 64 ? digest : undefined;
  } catch {
    return undefined;
  }
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): SemverParts | undefined {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? []
  };
}

function compareSemverParts(left: SemverParts, right: SemverParts): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}
