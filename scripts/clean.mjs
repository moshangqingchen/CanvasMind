import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const deep = process.argv.includes("--deep");
const removed = [];

async function removeGenerated(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error(`Refusing to remove path outside the workspace: ${resolved}`);
  await rm(resolved, { recursive: true, force: true });
  removed.push(relative);
}

const webRoot = path.join(root, "apps", "web");
for (const entry of await readdir(webRoot, { withFileTypes: true })) {
  if (
    entry.isDirectory() &&
    (entry.name.startsWith(".next") ||
      ["out", "playwright-report", "test-results"].includes(entry.name))
  )
    await removeGenerated(path.join(webRoot, entry.name));
}

for (const scope of [path.join(root, "apps"), path.join(root, "packages")]) {
  for (const entry of await readdir(scope, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await removeGenerated(path.join(scope, entry.name, "dist"));
    if (deep) await removeGenerated(path.join(scope, entry.name, "node_modules"));
  }
}

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".log"))
    await removeGenerated(path.join(root, entry.name));
}
if (deep) await removeGenerated(path.join(root, "node_modules"));

console.log(JSON.stringify({ mode: deep ? "deep" : "generated", removed }, null, 2));
