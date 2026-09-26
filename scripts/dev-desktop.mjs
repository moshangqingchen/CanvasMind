import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SHARED_DEVELOPMENT_PACKAGES } from "../apps/desktop/src/development.mjs";

if (process.argv.slice(2).filter((arg) => arg !== "--").length || process.platform !== "win32" || process.arch !== "x64" || process.versions.node.split(".")[0] !== "24") {
  console.error("Run pnpm dev with Windows x64 Node.js 24. Use pnpm desktop:dev:production for a production-build preview.");
  process.exit(1);
}
const workspace = fileURLToPath(new URL("../", import.meta.url));
const desktop = join(workspace, "apps/desktop");
const require = createRequire(join(desktop, "package.json"));
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: workspace, stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
// Shared dist exports must exist before Next resolves them. Subsequent edits
// are maintained by Electron's watched compilers, without rebuilding Next.
for (const name of SHARED_DEVELOPMENT_PACKAGES) run([join(workspace, "node_modules/typescript/bin/tsc"), "-p", join(workspace, "packages", name, "tsconfig.json")]);
run([join(desktop, "scripts/build.mjs")]);
const env = { ...process.env, SUPERCANVAS_DEV_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [desktop, "--desktop-dev"], { cwd: workspace, env, stdio: ["inherit", "inherit", "inherit", "ipc"], windowsHide: true });
const stop = () => { if (child.connected) child.send({ type: "desktop-dev:stop" }); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code || 0; });
