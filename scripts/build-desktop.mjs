import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (
  args.some((arg) => !["--run", "--unpacked"].includes(arg)) ||
  (args.includes("--run") && args.includes("--unpacked"))
) {
  console.error("Usage: node scripts/build-desktop.mjs [--run | --unpacked]");
  process.exit(1);
}
if (
  process.platform !== "win32" ||
  process.arch !== "x64" ||
  process.versions.node.split(".")[0] !== "24"
) {
  console.error(
    "Build and run the desktop app with Windows x64 Node.js 24. Use pnpm build:runtime for cross-platform runtime checks.",
  );
  process.exit(1);
}
const workspace = fileURLToPath(new URL("../", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
function run(args, env = {}) {
  // Only fixed, repository-owned arguments are passed through the Windows cmd shim.
  const result = spawnSync(pnpm, args, {
    cwd: workspace,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
run([
  "--filter",
  "@super-canvas/runtime...",
  "--filter",
  "@super-canvas/director...",
  "build",
]);
run(["--filter", "@super-canvas/desktop-ui", "build"], {
  NEXT_TELEMETRY_DISABLED: "1",
});
run(["--filter", "@super-canvas/desktop", "build"]);
run(["--filter", "@super-canvas/desktop", "run", "stage"]);
// Development uses the same isolated runtime as the installed app, without
// creating an installer or publishing artifacts.
run([
  "--filter",
  "@super-canvas/desktop",
  "run",
  args.includes("--run")
    ? "start"
    : args.includes("--unpacked")
      ? "pack"
      : "dist",
]);
if (!args.includes("--run")) {
  const result = spawnSync(process.execPath, ["apps/desktop/scripts/verify-release.mjs", ...(args.includes("--unpacked") ? ["--unpacked"] : [])], {
    cwd: workspace, stdio: "inherit", windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
