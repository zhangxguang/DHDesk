import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared renderer copy", () => {
  it("does not expose macOS-only descriptions in cross-platform pages", async () => {
    const pages = await Promise.all([
      readFile(resolve("src/renderer/startup.html"), "utf8"),
      readFile(resolve("src/renderer/updater.html"), "utf8"),
      readFile(resolve("src/renderer/app-updater.html"), "utf8")
    ]);

    const copy = pages.join("\n");
    expect(copy).not.toMatch(/\bmacOS\b|\bMac\b|Developer ID|Gatekeeper|~\/\.dsh/);
    expect(copy).toContain("DEEPSEEK HARNESS DESKTOP");
    expect(copy).toContain("服务仅在本机运行");
  });
});
