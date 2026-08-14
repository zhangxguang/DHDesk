import { describe, expect, it } from "vitest";
import { shouldMinimizeOnClose } from "../src/main/window-behavior";

describe("window close behavior", () => {
  it("minimizes a Windows main window when the app is still running", () => {
    expect(shouldMinimizeOnClose("win32", false)).toBe(true);
  });

  it("allows a Windows main window to close during app shutdown", () => {
    expect(shouldMinimizeOnClose("win32", true)).toBe(false);
  });

  it("minimizes a macOS main window when the app is still running", () => {
    expect(shouldMinimizeOnClose("darwin", false)).toBe(true);
  });

  it("allows a macOS main window to close during app shutdown", () => {
    expect(shouldMinimizeOnClose("darwin", true)).toBe(false);
  });

  it("does not change close behavior on unsupported platforms", () => {
    expect(shouldMinimizeOnClose("linux", false)).toBe(false);
  });
});
