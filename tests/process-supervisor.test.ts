import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeLogger } from "../src/main/logging";
import { buildWindowsTreeKillArgs, terminateProcessTree } from "../src/main/process-tree";
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

describe("Windows process tree termination", () => {
  it("builds taskkill arguments without using a shell command string", () => {
    expect(buildWindowsTreeKillArgs(4312, false)).toEqual(["/PID", "4312", "/T"]);
    expect(buildWindowsTreeKillArgs(4312, true)).toEqual(["/PID", "4312", "/T", "/F"]);
    expect(() => buildWindowsTreeKillArgs(-1, true)).toThrow("无效的进程 PID");
  });

  it("terminates a detached Node process on the native platform", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: process.platform === "win32"
    });
    await once(child, "spawn");
    await terminateProcessTree(child, { gracefulTimeoutMs: 300, forceTimeoutMs: 1_000 });
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
