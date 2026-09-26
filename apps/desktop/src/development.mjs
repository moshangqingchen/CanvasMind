import { spawn } from "node:child_process";
import { join, isAbsolute } from "node:path";

export const SHARED_DEVELOPMENT_PACKAGES = ["core", "db", "storage", "providers", "runtime", "director"];

export function developmentCommands(workspace, node, hook, port) {
  if (!isAbsolute(node) || !isAbsolute(workspace)) throw new Error("Development runtime paths must be absolute");
  const renderer = join(workspace, "apps/desktop/renderer");
  return {
    server: { executable: node, args: ["--require", hook, join(renderer, "node_modules/next/dist/bin/next"), "dev", renderer, "--hostname", "127.0.0.1", "--port", String(port)], cwd: renderer },
    watchers: SHARED_DEVELOPMENT_PACKAGES.map((name) => ({
      executable: node,
      args: ["--require", hook, join(workspace, "node_modules/typescript/bin/tsc"), "--project", join(workspace, "packages", name, "tsconfig.json"), "--watch", "--preserveWatchOutput"],
      cwd: workspace,
    })),
  };
}

/** Children are owned handles, never a process-name scan or an arbitrary PID. */
export async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolve) => {
    let forced;
    const done = () => { clearTimeout(timeout); clearTimeout(forced); resolve(); };
    child.once("exit", done);
    const timeout = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode) return done();
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else child.kill("SIGKILL");
      forced = setTimeout(done, 2000);
    }, 3000);
    if (child.connected) child.disconnect();
    else child.kill();
  });
}
