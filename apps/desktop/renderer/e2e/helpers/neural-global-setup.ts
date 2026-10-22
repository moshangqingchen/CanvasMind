import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import { createTestEnvironment } from "../test-environment";

const renderer = fileURLToPath(new URL("../..", import.meta.url));
const repository = resolve(renderer, "../../..");
const output = resolve(
  repository,
  process.env.NEURAL_EVIDENCE_DIR ?? ".codex-logs/2026-10-16-redesign/out",
);
const token = "supercanvas-isolated-e2e-session";

async function stop(server: ChildProcess) {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  else {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => server.once("exit", resolve));
  }
}

/** Owned loopback-only runtime, ephemeral data, no imported account or user profile. */
export default async function neuralGlobalSetup(config: FullConfig) {
  if (process.env.PLAYWRIGHT_BASE_URL)
    throw new Error("Neural acceptance refuses external or reused servers");
  const baseURL = String(config.projects[0]?.use.baseURL);
  const healthURL = new URL("/api/health", baseURL).href;
  const reachable = () =>
    fetch(healthURL, {
      signal: AbortSignal.timeout(1000),
      headers: { "x-supercanvas-desktop-token": token },
    }).then(
      (response) => response.ok,
      () => false,
    );
  if (await reachable())
    throw new Error("Neural acceptance port is already in use");
  await mkdir(join(repository, ".codex-temp"), { recursive: true });
  await mkdir(output, { recursive: true });
  const ffmpegTarget = join(
    repository,
    ".codex-temp/playwright-browsers/ffmpeg-1011/ffmpeg-win64.exe",
  );
  const exists = (path: string) =>
    access(path).then(
      () => true,
      () => false,
    );
  if (process.platform === "win32" && !(await exists(ffmpegTarget))) {
    const suppliedFfmpeg = process.env.NEURAL_FFMPEG_PATH;
    if (!suppliedFfmpeg || !(await exists(suppliedFfmpeg)))
      throw new Error(
        "Set NEURAL_FFMPEG_PATH to an existing ffmpeg executable; neural acceptance never installs or downloads tools",
      );
    await mkdir(resolve(ffmpegTarget, ".."), { recursive: true });
    await copyFile(suppliedFfmpeg, ffmpegTarget);
  }
  const environment = await createTestEnvironment(baseURL, token);
  process.env.SUPERCANVAS_E2E_DATA_ROOT = environment.root;
  const guard = join(environment.root, "neural-loopback-only.cjs");
  const networkLog = join(output, "neural-server-external-attempts.jsonl");
  const requestLog = join(output, "neural-server-request-hosts.jsonl");
  const localVersionLog = join(output, "neural-server-local-version-checks.jsonl");
  await writeFile(networkLog, "");
  await writeFile(requestLog, "");
  await writeFile(localVersionLog, "");
  await writeFile(
    guard,
    `const net = require('node:net');
const fs = require('node:fs');
${process.env.NEURAL_DISABLE_VERSION_CHECK === "1" ? `const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const method = init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input?.method : undefined) ?? 'GET';
  if (href === 'https://registry.npmjs.org/-/package/next/dist-tags' && method === 'GET') {
    fs.appendFileSync(${JSON.stringify(localVersionLog)}, JSON.stringify({ at: new Date().toISOString(), lookup: 'next-dist-tags', answeredLocally: true, status: 503 }) + '\\n');
    return new Response(null, { status: 503 });
  }
  return Reflect.apply(originalFetch, this, [input, init]);
};
` : ""}
require('node:diagnostics_channel').channel('undici:request:create').subscribe(({request}) => {
  let url; try { url = new URL(String(request.origin)); } catch { return; }
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return;
  fs.appendFileSync(${JSON.stringify(requestLog)}, JSON.stringify({at: new Date().toISOString(), hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? '443' : '80'), method: request.method, stack: new Error().stack?.split('\\n').slice(1, 10).map(line => line.replace(/https?:\\/\\/[^\\s)]+/g, '[url]'))}) + '\\n');
});
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    const port = typeof first === 'object' ? first.port : typeof first === 'number' ? first : undefined;
    const stack = new Error().stack?.split('\\n').slice(1, 7).map(line => line.replace(/https?:\\/\\/[^\\s)]+/g, '[url]'));
    fs.appendFileSync(${JSON.stringify(networkLog)}, JSON.stringify({ at: new Date().toISOString(), blockedBeforeConnect: true, hostname: String(host).slice(0, 253), port, stack }) + '\\n');
    throw new Error('Neural isolated runtime blocks non-loopback network');
  }
  return Reflect.apply(original, this, args);
};\n`,
  );
  const development = process.env.NEURAL_TEST_DEV === "1";
  let logs = "";
  const server = spawn(
    process.execPath,
    [
      "--require",
      guard,
      "./node_modules/next/dist/bin/next",
      development ? "dev" : "start",
      "-H",
      "127.0.0.1",
      "-p",
      new URL(baseURL).port,
    ],
    {
      cwd: renderer,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...environment.env,
        NODE_ENV: development ? "development" : "production",
        SUPERCANVAS_UI_PREVIEW: development ? "1" : "0",
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NODE_OPTIONS: "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  const append = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString("utf8")}`.slice(-32_000);
  };
  server.stdout?.on("data", append);
  server.stderr?.on("data", append);
  const cleanup = async () => {
    await stop(server);
    await writeFile(join(output, "neural-server-log.txt"), logs);
    await environment.cleanup();
  };
  try {
    const deadline = Date.now() + (development ? 120_000 : 60_000);
    while (!(await reachable())) {
      if (server.exitCode !== null || Date.now() > deadline)
        throw new Error(`Neural runtime failed to become ready\n${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const buildId = development
      ? "development-preview"
      : (
          await readFile(join(renderer, ".next-desktop/BUILD_ID"), "utf8")
        ).trim();
    await writeFile(
      join(output, "neural-test-environment.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          baseURL,
          buildId,
          ephemeralDataRoot: environment.root,
          network:
            "server TCP restricted to loopback; browser APIs served by in-memory fixture",
          profileCopied: false,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
  return async () => {
    await cleanup();
    const attempts = (await readFile(networkLog, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean);
    await writeFile(
      join(output, "neural-server-teardown.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          stoppedOwnedServer: true,
          removedEphemeralData: true,
          blockedBeforeConnect: attempts.length,
          successfulExternalConnections: 0,
        },
        null,
        2,
      ),
    );
    if (attempts.length)
      throw new Error(
        `${attempts.length} forbidden server external requests were blocked`,
      );
  };
}
