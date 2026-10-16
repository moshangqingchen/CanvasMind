import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";
import { createTestEnvironment } from "../test-environment";
import { minimumAvailableMemoryBytes } from "./performance-environment";

async function startOwnedRuntime(config: FullConfig, output: string, expectedBuildId: string) {
  const copied = Boolean(process.env.P0_MEMORY_RUNTIME_DIR);
  const runtime = copied ? await realpath(process.env.P0_MEMORY_RUNTIME_DIR!) : fileURLToPath(new URL("../..", import.meta.url));
  let owner: Record<string, unknown> | null = null;
  let node = process.execPath;
  let hook: string | null = null;
  let entry = join(runtime, "node_modules", "next", "dist", "bin", "next");
  let cwd = runtime;
  if (copied) {
    const evidence = await realpath(process.env.P0_MEMORY_EVIDENCE_ROOT ?? dirname(output));
    if (!runtime.toLowerCase().startsWith(`${evidence.toLowerCase()}${sep}`)) throw new Error("Copied runtime must be inside the evidence directory");
    owner = JSON.parse(await readFile(join(runtime, ".p0-owned-runtime.json"), "utf8"));
    if (!owner || owner.owner !== "codex-phase3-p0-memory" || owner.profileCopied !== false || owner.requireEphemeralProfile !== true)
      throw new Error("Runtime ownership/ephemeral marker is missing or invalid");
    const ownedPath = (relative: unknown) => {
      if (typeof relative !== "string") throw new Error("Invalid runtime marker path");
      const path = resolve(runtime, relative);
      if (!path.toLowerCase().startsWith(`${runtime.toLowerCase()}${sep}`)) throw new Error("Runtime marker path escapes owned copy");
      return path;
    };
    node = ownedPath(owner.nodeRelativePath); hook = ownedPath(owner.hookRelativePath); entry = ownedPath(owner.serverRelativePath); cwd = dirname(entry);
  }
  const buildId = (await readFile(join(cwd, ".next-desktop", "BUILD_ID"), "utf8")).trim();
  if (buildId !== expectedBuildId || (copied && owner?.buildId !== buildId)) throw new Error(`Production runtime build mismatch: ${buildId}`);
  const baseURL = String(config.projects[0]!.use.baseURL);
  const token = "supercanvas-isolated-e2e-session";
  const healthURL = `${baseURL}/api/health`;
  if (await fetch(healthURL, { signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false)) throw new Error("Isolation port is already in use");
  const environment = await createTestEnvironment(baseURL, token);
  const guard = join(environment.root, "loopback-only.cjs");
  const networkLog = join(output, "server-external-attempts.jsonl");
  await writeFile(networkLog, "", { flag: "wx" });
  await writeFile(guard, `const net = require('node:net');
const fs = require('node:fs');
const crypto = require('node:crypto');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  const host = typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    fs.appendFileSync(${JSON.stringify(networkLog)}, JSON.stringify({ timestamp: new Date().toISOString(), pid: process.pid,
      hostHash: crypto.createHash('sha256').update(String(host)).digest('hex'), blockedBeforeConnect: true }) + '\\n');
    throw new Error('P0 isolated server blocks external network');
  }
  return Reflect.apply(original, this, args);
};\n`, "utf8");
  const args = ["--require", guard, ...(hook ? ["--require", hook] : []), entry,
    ...(copied ? [] : ["start", "-H", "127.0.0.1", "-p", new URL(baseURL).port])];
  const server = spawn(node, args, { cwd, windowsHide: true,
    env: { ...environment.env, PORT: new URL(baseURL).port, HOSTNAME: "127.0.0.1", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NODE_OPTIONS: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  const append = (chunk: Buffer) => { logs = `${logs}${chunk.toString("utf8")}`.slice(-16_000); };
  server.stdout?.on("data", append); server.stderr?.on("data", append);
  const cleanup = async () => {
    if (server.pid && server.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      else server.kill("SIGTERM");
    }
    await writeFile(join(output, "server-log-tail.txt"), logs);
    await environment.cleanup();
  };
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Copied runtime exited: ${server.exitCode}\n${logs}`);
      ready = await fetch(healthURL, { headers: { "x-supercanvas-desktop-token": token }, signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Copied runtime readiness timeout\n${logs}`);
    await writeFile(join(output, "runtime-server.json"), JSON.stringify({ runtime, buildId, owner, pid: server.pid, entry, node, hook,
      isolatedDataRoot: environment.root, network: "preload blocks and records non-loopback TCP before Socket.connect; applies equally to copied and workspace production servers", profileCopied: false }, null, 2));
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}

export default async function p0MemoryGlobalSetup(config: FullConfig) {
  if (process.env.P0_MEMORY_SOAK !== "1" && process.env.P0_MEMORY_RETENTION !== "1") return;
  if (process.env.PLAYWRIGHT_BASE_URL) throw new Error("P0 memory soak refuses external/reused servers");
  const output = process.env.P0_MEMORY_OUTPUT_DIR;
  const expectedBuildId = process.env.P0_MEMORY_EXPECTED_BUILD_ID;
  if (!output || !expectedBuildId) throw new Error("Set P0_MEMORY_OUTPUT_DIR and P0_MEMORY_EXPECTED_BUILD_ID explicitly");
  const buildId = (await readFile(new URL("../../.next-desktop/BUILD_ID", import.meta.url), "utf8")).trim();
  if (!process.env.P0_MEMORY_RUNTIME_DIR && buildId !== expectedBuildId) throw new Error(`Frozen build mismatch: expected ${expectedBuildId}, actual ${buildId}`);
  await mkdir(output, { recursive: true });
  const availableMemoryBytes = freemem();
  const valid = availableMemoryBytes >= minimumAvailableMemoryBytes;
  await writeFile(join(output, "server-preflight.json"), JSON.stringify({
    timestamp: new Date().toISOString(), repositoryBuildId: buildId, expectedRuntimeBuildId: expectedBuildId, availableMemoryBytes, minimumAvailableMemoryBytes, valid,
    mode: process.env.P0_MEMORY_RUNTIME_DIR ? "owned copied production runtime; ephemeral isolated data; no build" : "owned workspace production Next; ephemeral isolated data; no build",
    invalidReasons: valid ? [] : ["available-memory-below-6-GiB"],
  }, null, 2));
  if (!valid && process.env.P0_MEMORY_ALLOW_INVALID_DIAGNOSTIC !== "1")
    throw new Error("Available memory below 6 GiB; preflight saved as invalid. No server/browser started.");
  const teardown = await startOwnedRuntime(config, output, expectedBuildId);
  return async () => {
    try { await teardown?.(); }
    finally {
      const attempts = (await readFile(join(output, "server-external-attempts.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).length;
      await writeFile(join(output, "server-teardown.json"), JSON.stringify({
        timestamp: new Date().toISOString(), cleanup: "owned production server stopped + isolated environment.cleanup", blockedExternalAttempts: attempts, successfulExternalConnections: 0,
        finalBuildId: (await readFile(new URL("../../.next-desktop/BUILD_ID", import.meta.url), "utf8")).trim(),
      }, null, 2));
      if (attempts) throw new Error(`P0 server attempted ${attempts} forbidden external connections (all blocked)`);
    }
  };
}
