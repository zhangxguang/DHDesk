import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readActiveRuntime } from "./active-runtime";
import {
  readRuntimePlatformMetadata,
  validateRuntimePlatformMetadata
} from "./runtime-metadata";
import { resolveRuntimeLayout } from "./runtime-platform";

const DSH_PACKAGE_PATH = join("node_modules", "@deepseek-ai", "dsh");
const DSH_ENTRY_PATH = join(DSH_PACKAGE_PATH, "lib", "bin.js");

export interface RuntimeInstallation {
  entryPath: string;
  rootPath: string;
  version: string;
  source: "override" | "managed" | "bundled" | "development";
  pendingValidation?: boolean;
  previousVersion?: string;
  metadataMissing?: boolean;
}

export interface RuntimeLocatorOptions {
  appRoot: string;
  resourcesPath: string;
  userDataPath: string;
  entryOverride?: string;
  platform?: string;
  arch?: string;
  nodeVersion?: string;
}

export interface NodeRuntime {
  executablePath: string;
  electronAsNode: boolean;
}

export interface NodeRuntimeIdentity {
  platform: string;
  arch: string;
  version: string;
}

interface RuntimeCandidate {
  entryPath: string;
  rootPath: string;
  source: RuntimeInstallation["source"];
  pendingValidation?: boolean;
  previousVersion?: string;
}

export async function locateNpmCli(options: {
  appRoot: string;
  resourcesPath: string;
  platform?: string;
  arch?: string;
}): Promise<string> {
  const layout = resolveRuntimeLayout(options.platform ?? process.platform, options.arch ?? process.arch);
  const candidates = [
    join(options.resourcesPath, "node", ...layout.npmCliParts),
    join(options.appRoot, "resources", "node", ...layout.npmCliParts)
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`未找到 ${layout.target} 内置 npm，无法安装 Harness 更新。`);
}

export async function locateHarnessRuntime(options: RuntimeLocatorOptions): Promise<RuntimeInstallation> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  resolveRuntimeLayout(platform, arch);
  const candidates: RuntimeCandidate[] = [];

  if (options.entryOverride) {
    const entryPath = resolve(options.entryOverride);
    candidates.push({
      entryPath,
      rootPath: resolve(entryPath, "..", "..", "..", "..", ".."),
      source: "override"
    });
  }

  const activeRuntime = await readActiveRuntime(options.userDataPath);
  if (activeRuntime) {
    const rootPath = join(options.userDataPath, "runtimes", activeRuntime.version);
    candidates.push({
      entryPath: join(rootPath, DSH_ENTRY_PATH),
      rootPath,
      source: "managed",
      pendingValidation: activeRuntime.pendingValidation,
      previousVersion: activeRuntime.previousVersion
    });
  }

  const bundledRoot = join(options.resourcesPath, "bundled-runtime");
  candidates.push({
    entryPath: join(bundledRoot, DSH_ENTRY_PATH),
    rootPath: bundledRoot,
    source: "bundled"
  });

  const developmentRoot = join(options.appRoot, "resources", "bundled-runtime");
  candidates.push({
    entryPath: join(developmentRoot, DSH_ENTRY_PATH),
    rootPath: developmentRoot,
    source: "development"
  });

  const rejected: string[] = [];
  for (const candidate of candidates) {
    if (!(await exists(candidate.entryPath))) continue;
    const version = await readHarnessVersion(candidate.rootPath);
    if (version === "unknown") {
      rejected.push(`${candidate.source}: Harness 版本不可读`);
      continue;
    }

    if (candidate.source === "override") return { ...candidate, version };

    try {
      const metadata = await readRuntimePlatformMetadata(candidate.rootPath);
      if (!metadata) {
        if (candidate.source === "managed") {
          return { ...candidate, version, metadataMissing: true };
        }
        rejected.push(`${candidate.source}: 缺少 runtime-platform.json`);
        continue;
      }
      validateRuntimePlatformMetadata(metadata, {
        platform,
        arch,
        nodeVersion: options.nodeVersion,
        harnessVersion: version
      });
      return { ...candidate, version };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      rejected.push(`${candidate.source}: ${details}`);
    }
  }

  const suffix = rejected.length > 0 ? ` 已拒绝的 Runtime：${rejected.join("；")}` : "";
  throw new Error(
    `DeepSeek Harness Runtime 未安装或与当前平台不匹配。` +
      `开发环境请先运行 npm run runtime:prepare，然后重新启动 DHDesk。${suffix}`
  );
}

export async function locateNodeRuntime(options: {
  appRoot: string;
  resourcesPath: string;
  executableOverride?: string;
  electronExecutable: string;
  isElectron: boolean;
  platform?: string;
  arch?: string;
}): Promise<NodeRuntime> {
  const layout = resolveRuntimeLayout(options.platform ?? process.platform, options.arch ?? process.arch);
  const candidates = [
    options.executableOverride ? resolve(options.executableOverride) : undefined,
    join(options.resourcesPath, "node", ...layout.nodeExecutableParts),
    join(options.appRoot, "resources", "node", ...layout.nodeExecutableParts)
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const executablePath of candidates) {
    if (await exists(executablePath)) return { executablePath, electronAsNode: false };
  }

  if (options.isElectron) {
    return { executablePath: options.electronExecutable, electronAsNode: true };
  }

  throw new Error(`未找到可用的 ${layout.target} 内置 Node.js Runtime。请运行 npm run runtime:prepare:node。`);
}

export async function inspectNodeRuntime(runtime: NodeRuntime): Promise<NodeRuntimeIdentity> {
  const environment = { ...process.env };
  if (runtime.electronAsNode) environment.ELECTRON_RUN_AS_NODE = "1";
  else delete environment.ELECTRON_RUN_AS_NODE;
  const output = await runNodeInspection(runtime.executablePath, environment);
  let identity: unknown;
  try {
    identity = JSON.parse(output);
  } catch {
    throw new Error("内置 Node.js 自检返回了无效数据。");
  }
  const value = identity as Partial<NodeRuntimeIdentity>;
  if (
    typeof value.platform !== "string" ||
    typeof value.arch !== "string" ||
    typeof value.version !== "string"
  ) {
    throw new Error("内置 Node.js 自检缺少平台、架构或版本。");
  }
  resolveRuntimeLayout(value.platform, value.arch);
  return { platform: value.platform, arch: value.arch, version: value.version };
}

async function runNodeInspection(executablePath: string, environment: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      executablePath,
      ["-p", "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})"],
      {
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: process.platform === "win32"
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`内置 Node.js 自检失败（code=${String(code)}）：${stderr.trim()}`));
    });
  });
}

async function readHarnessVersion(runtimeRoot: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(runtimeRoot, DSH_PACKAGE_PATH, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
