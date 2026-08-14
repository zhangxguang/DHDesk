import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveRuntimeLayout,
  type SupportedRuntimeArch,
  type SupportedRuntimePlatform
} from "./runtime-platform";

export const RUNTIME_PLATFORM_FILE = "runtime-platform.json";

export interface RuntimePlatformMetadata {
  platform: SupportedRuntimePlatform;
  arch: SupportedRuntimeArch;
  nodeVersion: string;
  harnessVersion: string;
}

export interface ExpectedRuntimeMetadata {
  platform: string;
  arch: string;
  nodeVersion?: string;
  harnessVersion?: string;
}

export class RuntimeMetadataError extends Error {
  constructor(
    message: string,
    readonly reason: "missing" | "invalid" | "mismatch"
  ) {
    super(message);
    this.name = "RuntimeMetadataError";
  }
}

export function createRuntimePlatformMetadata(options: ExpectedRuntimeMetadata): RuntimePlatformMetadata {
  const layout = resolveRuntimeLayout(options.platform, options.arch);
  if (!isSafeMetadataVersion(options.nodeVersion)) {
    throw new RuntimeMetadataError("Runtime 平台标记缺少有效的 Node.js 版本。", "invalid");
  }
  if (!isSafeMetadataVersion(options.harnessVersion)) {
    throw new RuntimeMetadataError("Runtime 平台标记缺少有效的 Harness 版本。", "invalid");
  }
  return {
    platform: layout.platform,
    arch: layout.arch,
    nodeVersion: options.nodeVersion,
    harnessVersion: options.harnessVersion
  };
}

export function parseRuntimePlatformMetadata(value: unknown): RuntimePlatformMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeMetadataError("Runtime 平台标记格式无效。", "invalid");
  }
  const metadata = value as Record<string, unknown>;
  if (typeof metadata.platform !== "string" || typeof metadata.arch !== "string") {
    throw new RuntimeMetadataError("Runtime 平台标记缺少平台或架构。", "invalid");
  }

  let layout;
  try {
    layout = resolveRuntimeLayout(metadata.platform, metadata.arch);
  } catch {
    throw new RuntimeMetadataError(
      `Runtime 平台标记包含不支持的目标：${metadata.platform}-${metadata.arch}。`,
      "invalid"
    );
  }
  if (!isSafeMetadataVersion(metadata.nodeVersion)) {
    throw new RuntimeMetadataError("Runtime 平台标记缺少有效的 Node.js 版本。", "invalid");
  }
  if (!isSafeMetadataVersion(metadata.harnessVersion)) {
    throw new RuntimeMetadataError("Runtime 平台标记缺少有效的 Harness 版本。", "invalid");
  }

  return {
    platform: layout.platform,
    arch: layout.arch,
    nodeVersion: metadata.nodeVersion,
    harnessVersion: metadata.harnessVersion
  };
}

export function validateRuntimePlatformMetadata(
  metadata: RuntimePlatformMetadata,
  expected: ExpectedRuntimeMetadata
): void {
  const expectedLayout = resolveRuntimeLayout(expected.platform, expected.arch);
  if (metadata.platform !== expectedLayout.platform || metadata.arch !== expectedLayout.arch) {
    throw new RuntimeMetadataError(
      `Runtime 平台不匹配：期望 ${expectedLayout.target}，实际 ${metadata.platform}-${metadata.arch}。`,
      "mismatch"
    );
  }
  if (expected.nodeVersion !== undefined && metadata.nodeVersion !== expected.nodeVersion) {
    throw new RuntimeMetadataError(
      `Runtime Node.js 版本不匹配：期望 ${expected.nodeVersion}，实际 ${metadata.nodeVersion}。`,
      "mismatch"
    );
  }
  if (expected.harnessVersion !== undefined && metadata.harnessVersion !== expected.harnessVersion) {
    throw new RuntimeMetadataError(
      `Runtime Harness 版本不匹配：期望 ${expected.harnessVersion}，实际 ${metadata.harnessVersion}。`,
      "mismatch"
    );
  }
}

export async function readRuntimePlatformMetadata(
  runtimeRoot: string
): Promise<RuntimePlatformMetadata | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(runtimeRoot, RUNTIME_PLATFORM_FILE), "utf8"));
    return parseRuntimePlatformMetadata(value);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    if (error instanceof RuntimeMetadataError) throw error;
    throw new RuntimeMetadataError("Runtime 平台标记不是有效的 JSON。", "invalid");
  }
}

export async function requireRuntimePlatformMetadata(
  runtimeRoot: string,
  expected: ExpectedRuntimeMetadata
): Promise<RuntimePlatformMetadata> {
  const metadata = await readRuntimePlatformMetadata(runtimeRoot);
  if (!metadata) {
    throw new RuntimeMetadataError(`Runtime 缺少 ${RUNTIME_PLATFORM_FILE}。`, "missing");
  }
  validateRuntimePlatformMetadata(metadata, expected);
  return metadata;
}

export async function ensureRuntimePlatformMetadata(
  runtimeRoot: string,
  expected: ExpectedRuntimeMetadata
): Promise<{ metadata: RuntimePlatformMetadata; created: boolean }> {
  const metadata = await readRuntimePlatformMetadata(runtimeRoot);
  if (metadata) {
    validateRuntimePlatformMetadata(metadata, expected);
    return { metadata, created: false };
  }
  const created = createRuntimePlatformMetadata(expected);
  await writeRuntimePlatformMetadata(runtimeRoot, created);
  return { metadata: created, created: true };
}

export async function writeRuntimePlatformMetadata(
  runtimeRoot: string,
  metadata: RuntimePlatformMetadata
): Promise<void> {
  const parsed = parseRuntimePlatformMetadata(metadata);
  const destination = join(runtimeRoot, RUNTIME_PLATFORM_FILE);
  const temporary = join(runtimeRoot, `.${RUNTIME_PLATFORM_FILE}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isSafeMetadataVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value) &&
    !value.includes("..")
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
