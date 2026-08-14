import layouts from "../src/main/runtime-layouts.json" with { type: "json" };

export function resolveRuntimeLayout(platform, arch) {
  const target = `${platform}-${arch}`;
  const layout = layouts[target];
  if (!layout) {
    throw new Error(
      `不支持的 DHDesk Runtime 构建目标：${target}。仅支持 darwin-arm64 和 win32-x64。`
    );
  }
  return { target, ...layout };
}

export function nodeArchiveName(version, layout) {
  return `node-${version}-${layout.nodeArchiveSuffix}`;
}

export function nodeArchiveDirectory(version, layout) {
  return `node-${version}-${layout.nodeArchiveDirectorySuffix}`;
}
