import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("src/renderer");
const target = resolve("dist/renderer");

await mkdir(target, { recursive: true });
await Promise.all([
  copyFile(resolve(source, "startup.html"), resolve(target, "startup.html")),
  copyFile(resolve(source, "startup.css"), resolve(target, "startup.css"))
]);
