import layouts from "./runtime-layouts.json";

export type SupportedRuntimePlatform = "darwin" | "win32";
export type SupportedRuntimeArch = "arm64" | "x64";
export type RuntimeTarget = "darwin-arm64" | "win32-x64";

export interface RuntimeLayout {
  target: RuntimeTarget;
  platform: SupportedRuntimePlatform;
  arch: SupportedRuntimeArch;
  nodeArchiveFormat: "tar.xz" | "zip";
  nodeArchiveSuffix: string;
  nodeArchiveDirectorySuffix: string;
  nodeExecutableParts: readonly string[];
  npmCliParts: readonly string[];
  npmCommandParts: readonly string[];
  npxCommandParts: readonly string[];
}

const runtimeLayouts = layouts as Record<RuntimeTarget, Omit<RuntimeLayout, "target">>;

export function resolveRuntimeLayout(platform: string, arch: string): RuntimeLayout {
  const target = `${platform}-${arch}`;
  if (target !== "darwin-arm64" && target !== "win32-x64") {
    throw new Error(
      `不支持的 DHDesk Runtime 构建目标：${target}。仅支持 darwin-arm64 和 win32-x64。`
    );
  }
  return { target, ...runtimeLayouts[target] };
}

export function nodeArchiveName(version: string, layout: RuntimeLayout): string {
  return `node-${version}-${layout.nodeArchiveSuffix}`;
}

export function nodeArchiveDirectory(version: string, layout: RuntimeLayout): string {
  return `node-${version}-${layout.nodeArchiveDirectorySuffix}`;
}
