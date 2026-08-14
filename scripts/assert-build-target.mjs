import { resolveRuntimeLayout } from "./runtime-platform.mjs";

const expectedPlatform = process.env.DHDESK_EXPECTED_PLATFORM;
const expectedArch = process.env.DHDESK_EXPECTED_ARCH;
if (!expectedPlatform || !expectedArch) {
  throw new Error("DHDESK_EXPECTED_PLATFORM and DHDESK_EXPECTED_ARCH are required.");
}

const expected = resolveRuntimeLayout(expectedPlatform, expectedArch);
const actual = resolveRuntimeLayout(process.platform, process.arch);
if (actual.target !== expected.target) {
  throw new Error(`Build runner mismatch: expected ${expected.target}, received ${actual.target}.`);
}
process.stdout.write(`Verified native build runner: ${actual.target}\n`);
