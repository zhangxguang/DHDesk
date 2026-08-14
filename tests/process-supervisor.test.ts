import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeLogger } from "../src/main/logging";
import { HarnessProcessSupervisor, parseHarnessUrl } from "../src/main/process-supervisor";

describe("parseHarnessUrl", () => {
  it("extracts the loopback URL printed by dsh web", () => {
    expect(parseHarnessUrl("dsh web: http://127.0.0.1:3080")).toBe("http://127.0.0.1:3080");
  });

  it("rejects a non-loopback URL", () => {
    expect(parseHarnessUrl("dsh web: http://192.168.1.8:3080")).toBeUndefined();
  });

  it("reports a process that exits before startup listeners can miss it", async () => {
    const root = await mkdtemp(join(tmpdir(), "dhdesk-fast-exit-"));
    const entry = join(root, "exit.cjs");
    await writeFile(entry, "process.exit(7);\n");

    try {
      const supervisor = new HarnessProcessSupervisor({
        nodeExecutable: process.execPath,
        electronAsNode: false,
        dshEntry: entry,
        version: "test",
        cwd: root,
        logger: new RuntimeLogger(join(root, "runtime.log")),
        startTimeoutMs: 2_000
      });

      await expect(supervisor.start()).rejects.toThrow("启动过程中退出");
      expect(supervisor.state.phase).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
