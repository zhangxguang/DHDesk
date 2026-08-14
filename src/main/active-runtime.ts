import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ACTIVE_RUNTIME_FILE = "active-runtime.json";

export interface ActiveRuntimeRecord {
  version: string;
  previousVersion?: string;
  pendingValidation: boolean;
  activatedAt: string;
}

export async function readActiveRuntime(userDataPath: string): Promise<ActiveRuntimeRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(join(userDataPath, ACTIVE_RUNTIME_FILE), "utf8")) as {
      version?: unknown;
      previousVersion?: unknown;
      pendingValidation?: unknown;
      activatedAt?: unknown;
    };
    if (typeof value.version !== "string" || !isSafeVersion(value.version)) return undefined;

    return {
      version: value.version,
      previousVersion:
        typeof value.previousVersion === "string" && isSafeVersion(value.previousVersion)
          ? value.previousVersion
          : undefined,
      pendingValidation: value.pendingValidation === true,
      activatedAt: typeof value.activatedAt === "string" ? value.activatedAt : new Date(0).toISOString()
    };
  } catch {
    return undefined;
  }
}

export async function activateRuntime(
  userDataPath: string,
  version: string,
  previousVersion?: string
): Promise<ActiveRuntimeRecord> {
  assertSafeVersion(version);
  if (previousVersion) assertSafeVersion(previousVersion);

  const record: ActiveRuntimeRecord = {
    version,
    previousVersion: previousVersion === version ? undefined : previousVersion,
    pendingValidation: true,
    activatedAt: new Date().toISOString()
  };
  await writeActiveRuntime(userDataPath, record);
  return record;
}

export async function confirmActiveRuntime(userDataPath: string, version: string): Promise<void> {
  const record = await readActiveRuntime(userDataPath);
  if (!record || record.version !== version || !record.pendingValidation) return;
  await writeActiveRuntime(userDataPath, { ...record, pendingValidation: false });
}

export async function rollbackActiveRuntime(userDataPath: string): Promise<string | undefined> {
  const record = await readActiveRuntime(userDataPath);
  if (!record?.pendingValidation) return undefined;

  if (record.previousVersion) {
    await writeActiveRuntime(userDataPath, {
      version: record.previousVersion,
      pendingValidation: false,
      activatedAt: new Date().toISOString()
    });
    return record.previousVersion;
  }

  await rm(join(userDataPath, ACTIVE_RUNTIME_FILE), { force: true });
  return undefined;
}

export function isSafeVersion(version: string): boolean {
  return (
    version.length > 0 &&
    version.length <= 128 &&
    /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version) &&
    !version.includes("..")
  );
}

export function assertSafeVersion(version: string): void {
  if (!isSafeVersion(version)) throw new Error(`不安全的 Harness 版本号：${version}`);
}

async function writeActiveRuntime(userDataPath: string, record: ActiveRuntimeRecord): Promise<void> {
  await mkdir(userDataPath, { recursive: true, mode: 0o700 });
  const destination = join(userDataPath, ACTIVE_RUNTIME_FILE);
  const temporary = join(userDataPath, `.active-runtime-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
}
