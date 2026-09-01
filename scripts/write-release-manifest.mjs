import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDir, "..");
const packageJson = JSON.parse(
  await readFile(resolve(workspace, "package.json"), "utf8"),
);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const version = argument("--version", packageJson.version);
const output = resolve(
  workspace,
  argument("--output", ".release-stage/release-manifest.json"),
);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version))
  throw new Error(`Invalid application version: ${version}`);

const manifest = {
  formatVersion: 1,
  app: "super-canvas",
  version,
  tag: `v${version}`,
  commit: argument("--commit", process.env.GITHUB_SHA || "unknown"),
  builtAt: new Date().toISOString(),
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${output}\n`);
