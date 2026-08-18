import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("packaged Node/npm Runtime configuration", () => {
  it("copies npm dependencies from a separate resource root on both platforms", async () => {
    const [macConfig, windowsConfig] = await Promise.all([
      readFile(resolve("electron-builder.mac.yml"), "utf8"),
      readFile(resolve("electron-builder.win.yml"), "utf8")
    ]);

    expect(macConfig).toContain("from: resources/node/lib/node_modules/npm/node_modules");
    expect(macConfig).toContain("to: node/lib/node_modules/npm/node_modules");
    expect(windowsConfig).toContain("from: resources/node/node_modules/npm/node_modules");
    expect(windowsConfig).toContain("to: node/node_modules/npm/node_modules");
  });

  it("runs the packaged npm smoke test for both CI artifacts", async () => {
    const workflow = await readFile(resolve(".github/workflows/build.yml"), "utf8");

    expect(workflow).toContain(
      "node scripts/verify-packaged-node-runtime.mjs release/mac-arm64/DHDesk.app/Contents/Resources/node"
    );
    expect(workflow).toContain(
      "node scripts/verify-packaged-node-runtime.mjs release/win-unpacked/resources/node"
    );
  });
});
