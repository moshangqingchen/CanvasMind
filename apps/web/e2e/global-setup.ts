import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(
  server: ChildProcess,
  healthUrl: string,
  diagnostics: () => string,
): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Next.js test server exited with ${server.exitCode}.\n${diagnostics()}`,
      );
    }
    if (await isReachable(healthUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Next.js test server did not become ready.\n${diagnostics()}`,
  );
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

export default async function globalSetup(config: FullConfig) {
  if (process.env.PLAYWRIGHT_BASE_URL) return;

  const baseURL = String(config.projects[0]?.use.baseURL);
  const healthUrl = new URL("/api/health", baseURL).toString();
  if (await isReachable(healthUrl)) {
    throw new Error(
      `${healthUrl} is already in use. Set PLAYWRIGHT_BASE_URL to explicitly reuse a server.`,
    );
  }

  const port = process.env.PLAYWRIGHT_PORT ?? "3211";
  const server = spawn(
    process.execPath,
    ["./node_modules/next/dist/bin/next", "start", "-p", port],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        USE_MEMORY_STORE: "ephemeral",
        MASTER_KEY: process.env.MASTER_KEY ?? "e2e-local-master-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-8_000);
  };
  server.stdout?.on("data", append);
  server.stderr?.on("data", append);

  try {
    await waitForServer(server, healthUrl, () => output);
  } catch (error) {
    await stopServer(server);
    throw error;
  }

  return async () => stopServer(server);
}
