import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function sanitizeLogLine(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_API_KEY]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export class RuntimeLogger {
  private ready: Promise<void>;

  constructor(readonly path: string) {
    this.ready = this.prepare();
  }

  async info(message: string): Promise<void> {
    await this.write("INFO", message);
  }

  async error(message: string): Promise<void> {
    await this.write("ERROR", message);
  }

  private async prepare(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });

    try {
      const current = await stat(this.path);
      if (current.size >= MAX_LOG_BYTES) {
        await rename(this.path, `${this.path}.1`).catch(() => undefined);
      }
    } catch {
      // The log does not exist on first launch.
    }
  }

  private async write(level: string, message: string): Promise<void> {
    await this.ready;
    const line = `${new Date().toISOString()} ${level} ${sanitizeLogLine(message)}\n`;
    await appendFile(this.path, line, { encoding: "utf8", mode: 0o600 });
  }
}
