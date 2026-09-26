import {
  cp,
  mkdir,
  rm,
  copyFile,
  readdir,
  lstat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, isAbsolute, basename } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  runtimeDependencies,
  validateRuntimeLock,
} from "./runtime-dependencies.mjs";
const desktop = fileURLToPath(new URL("../", import.meta.url));
const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const stage = join(desktop, "stage");
// Validate the exact removal target before recursively replacing generated output.
if (
  relative(desktop, stage) !== "stage" ||
  isAbsolute(relative(desktop, stage))
)
  throw new Error("Invalid staging directory");
if (
  process.platform !== "win32" ||
  process.arch !== "x64" ||
  process.versions.node.split(".")[0] !== "24"
)
  throw new Error("Build Windows x64 desktop with Windows x64 Node.js 24");
const { dependencies, aliases } = await runtimeDependencies(workspace);
const runtimeLock = await readFile(
  join(desktop, "runtime-package-lock.json"),
  "utf8",
);
validateRuntimeLock(JSON.parse(runtimeLock), dependencies);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const server = join(stage, "server");
const standalone = join(
  workspace,
  "apps/desktop/renderer/.next-desktop/standalone",
);
// Windows standalone contains absolute pnpm junctions. Following them expands
// dependency cycles and reaches the development tree. Copy only server files,
// then install the exact external package versions into a hoisted runtime tree.
const noModules = (path) => basename(path) !== "node_modules";
await cp(standalone, server, { recursive: true, filter: noModules });
await writeFile(
  join(server, "package.json"),
  JSON.stringify(
    {
      name: "super-canvas-desktop-runtime",
      private: true,
      type: "module",
      dependencies,
    },
    null,
    2,
  ),
);
await writeFile(join(server, "package-lock.json"), runtimeLock);
await new Promise((resolve, reject) => {
  const child = spawn(
    "npm.cmd",
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--install-strategy=hoisted",
    ],
    { cwd: server, shell: true, stdio: "inherit", windowsHide: true },
  );
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0
      ? resolve()
      : reject(new Error(`Runtime dependency installation failed: ${code}`)),
  );
});
for (const alias of aliases) {
  const source = join(server, "node_modules", alias.name);
  await cp(
    source,
    join(
      server,
      "apps/desktop/renderer/.next-desktop/node_modules",
      alias.path,
    ),
    { recursive: true, filter: (path) => path === source || noModules(path) },
  );
}
await cp(
  join(workspace, "apps/desktop/renderer/.next-desktop/static"),
  join(server, "apps/desktop/renderer/.next-desktop/static"),
  { recursive: true },
);
try {
  await cp(
    join(workspace, "apps/desktop/renderer/public"),
    join(server, "apps/desktop/renderer/public"),
    { recursive: true },
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await cp(
  join(workspace, "packages/director/knowledge"),
  join(server, "packages/director/knowledge"),
  { recursive: true },
);
// A trace must never introduce live application data, env files or junctions.
await cp(
  join(workspace, "packages/providers/examples"),
  join(server, "packages/providers/examples"),
  { recursive: true },
);
const audit = async (directory) => {
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error(`Runtime contains a link: ${relative(stage, path)}`);
    if (
      /^\.env(?:\.|$)|^\.local-public\.env$|^super-canvas\.json$|^secrets\.bin$|\.log$/.test(
        name,
      )
    )
      throw new Error(
        `Private runtime file included: ${relative(stage, path)}`,
      );
    if (info.isDirectory()) await audit(path);
  }
};
await audit(stage);
await copyFile(process.execPath, join(stage, "node.exe"));
const version = process.versions.node;
const response = await fetch(
  `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
);
if (!response.ok) throw new Error("Unable to verify bundled Node.js");
const sums = await response.text();
const expected = sums
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith("win-x64/node.exe"))
  ?.split(/\s+/)[0];
const actual = createHash("sha256")
  .update(await readFile(join(stage, "node.exe")))
  .digest("hex");
if (!expected || actual !== expected)
  throw new Error("Bundled Node.js does not match the official checksum");
const license = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`,
);
if (!license.ok) throw new Error("Unable to include Node.js license");
await writeFile(join(stage, "NODE-LICENSE.txt"), await license.text());
await writeFile(
  join(stage, "runtime-manifest.json"),
  JSON.stringify(
    {
      nodeVersion: version,
      nodeSha256: actual,
      dependencyLockSha256: createHash("sha256")
        .update(runtimeLock)
        .digest("hex"),
    },
    null,
    2,
  ),
);
console.log(
  "Standalone server, knowledge snapshot and verified Node.js runtime staged.",
);
