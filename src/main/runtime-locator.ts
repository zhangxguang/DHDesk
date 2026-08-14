import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readActiveRuntime } from "./active-runtime";

const DSH_PACKAGE_PATH = join("node_modules", "@deepseek-ai", "dsh");
const DSH_ENTRY_PATH = join(DSH_PACKAGE_PATH, "lib", "bin.js");

export interface RuntimeInstallation {
  entryPath: string;
  rootPath: string;
  version: string;
  source: "override" | "managed" | "bundled" | "development";
  pendingValidation?: boolean;
  previousVersion?: string;
}

export interface RuntimeLocatorOptions {
  appRoot: string;
  resourcesPath: string;
  userDataPath: string;
  entryOverride?: string;
}

export interface NodeRuntime {
  executablePath: string;
  electronAsNode: boolean;
}

export async function locateNpmCli(options: { appRoot: string; resourcesPath: string }): Promise<string> {
  const candidates = [
    join(options.resourcesPath, "node", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    join(options.appRoot, "resources", "node", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("未找到内置 npm，无法安装 Harness 更新。");
}

export async function locateHarnessRuntime(options: RuntimeLocatorOptions): Promise<RuntimeInstallation> {
  const candidates: Array<
    Pick<RuntimeInstallation, "entryPath" | "rootPath" | "source" | "pendingValidation" | "previousVersion">
  > = [];

  if (options.entryOverride) {
    candidates.push({
      entryPath: resolve(options.entryOverride),
      rootPath: resolve(options.entryOverride, "..", "..", ".."),
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

  for (const candidate of candidates) {
    if (!(await exists(candidate.entryPath))) continue;

    return {
      ...candidate,
      version: await readHarnessVersion(candidate.rootPath)
    };
  }

  throw new Error(
    "DeepSeek Harness Runtime 未安装。开发环境请先运行 npm run runtime:prepare，然后重新启动 DHDesk。"
  );
}

export async function locateNodeRuntime(options: {
  appRoot: string;
  resourcesPath: string;
  executableOverride?: string;
  electronExecutable: string;
  isElectron: boolean;
}): Promise<NodeRuntime> {
  const candidates = [
    options.executableOverride ? resolve(options.executableOverride) : undefined,
    join(options.resourcesPath, "node", "bin", "node"),
    join(options.appRoot, "resources", "node", "bin", "node")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const executablePath of candidates) {
    if (await exists(executablePath)) {
      return { executablePath, electronAsNode: false };
    }
  }

  if (options.isElectron) {
    return { executablePath: options.electronExecutable, electronAsNode: true };
  }

  throw new Error("未找到可用的内置 Node.js Runtime。请运行 npm run runtime:prepare:node。");
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
