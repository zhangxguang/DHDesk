import { describe, expect, it } from "vitest";
import { getWindowCloseBehavior } from "../src/main/window-behavior";

describe("window close behavior", () => {
  it("minimizes a Windows main window when the app is still running", () => {
    expect(getWindowCloseBehavior("win32", false)).toBe("minimize");
  });

  it("allows a Windows main window to close during app shutdown", () => {
    expect(getWindowCloseBehavior("win32", true)).toBe("close");
  });

  it("hides a macOS main window when the app is still running", () => {
    expect(getWindowCloseBehavior("darwin", false)).toBe("hide");
  });

  it("allows a macOS main window to close during app shutdown", () => {
    expect(getWindowCloseBehavior("darwin", true)).toBe("close");
  });

  it("does not change close behavior on unsupported platforms", () => {
    expect(getWindowCloseBehavior("linux", false)).toBe("close");
  });
});
