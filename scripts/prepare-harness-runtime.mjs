import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(projectRoot, "resources/runtime-manifest.json"), "utf8"));
const runtimeRoot = join(projectRoot, "resources/bundled-runtime");
const dshEntry = join(runtimeRoot, "node_modules/@deepseek-ai/dsh/lib/bin.js");
const nodeRoot = join(projectRoot, "resources/node");
const nodeExecutable = join(nodeRoot, "bin/node");
const npmCli = join(nodeRoot, "lib/node_modules/npm/bin/npm-cli.js");

try {
  await access(dshEntry);
  process.stdout.write(`Harness runtime already exists at ${runtimeRoot}\n`);
  process.exit(0);
} catch {
  // Continue with a clean, pinned install.
}

await Promise.all([access(nodeExecutable), access(npmCli)]).catch(() => {
  throw new Error("Bundled Node.js is missing. Run npm run runtime:prepare:node first.");
});

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await writeFile(
  join(runtimeRoot, "package.json"),
  `${JSON.stringify({
    private: true,
    name: "dhdesk-bundled-runtime",
    version: "0.0.0",
    allowScripts: {
      "@deepseek-ai/dsh-subprocess-local@0.1.0-rc.6": true,
      "@google/genai@1.52.0": true,
      "koffi@3.1.5": true,
      "node-pty@1.1.0": true,
      "protobufjs@7.6.5": true
    }
  }, null, 2)}\n`
);

await run(nodeExecutable, [
  npmCli,
  "install",
  "--save-exact",
  "--omit=dev",
  "--no-audit",
  "--no-fund",
  `@deepseek-ai/dsh@${manifest.harnessVersion}`
], runtimeRoot);

process.stdout.write(`Prepared DeepSeek Harness ${manifest.harnessVersion} at ${runtimeRoot}\n`);

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}
