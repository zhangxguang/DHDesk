import { describe, expect, it } from "vitest";
import { sanitizeLogLine } from "../src/main/logging";

describe("sanitizeLogLine", () => {
  it("redacts API keys and bearer tokens", () => {
    const input = "api_key=super-secret-value Authorization: Bearer token-123 sk-example-key-123456789";
    const output = sanitizeLogLine(input);

    expect(output).not.toContain("super-secret-value");
    expect(output).not.toContain("token-123");
    expect(output).not.toContain("sk-example-key-123456789");
  });
});
