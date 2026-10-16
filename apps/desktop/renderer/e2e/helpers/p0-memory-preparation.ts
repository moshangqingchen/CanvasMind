import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { createMemoryFixture, MemoryScenario } from "./p0-memory-fixture";

type MemoryFixture = Awaited<ReturnType<typeof createMemoryFixture>>;
type PreparationOwner = {
  owner: "codex-phase3-p0-memory-preparation"; nonce: string; scenario: MemoryScenario;
  parentWorkerPid: number; baseURL: string; expectedBuildId: string;
};
type PreparedEnvelope = {
  schemaVersion: 1;
  identity: PreparationOwner; preparationWorkerPid: number; preparedAt: string;
  catalogManifestSha256: string; fixtureSha256: string; fixture: MemoryFixture;
  childMemory: NodeJS.MemoryUsage; browserStarted: false; requestDisposed: true;
};
const maximumDescriptorBytes = 4 * 1024 * 1024;
const ownerName = "codex-phase3-p0-memory-preparation";
const descriptorName = "preparation-descriptor.json";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const childOf = (parent: string, path: string) => path.toLowerCase().startsWith(`${parent.toLowerCase()}${sep}`);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function readPreparationChildMode(value = process.env.P0_MEMORY_PREPARE_CHILD): boolean {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("P0_MEMORY_PREPARE_CHILD must be 0 or 1");
}

export function assertPreparationLoopback(baseURL: string) {
  const url = new URL(baseURL);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Preparation requires the exact isolated HTTP loopback origin");
}

export const memoryCatalogManifestDigest = (manifest: unknown) => digest(JSON.stringify(manifest ?? null));

export function decodePreparedMemoryFixture(text: string, expected: PreparationOwner): PreparedEnvelope {
  if (Buffer.byteLength(text) > maximumDescriptorBytes) throw new Error("Preparation descriptor is too large; media/catalog bodies must stay in the child");
  const value = JSON.parse(text) as PreparedEnvelope;
  if (value?.schemaVersion !== 1) throw new Error("Unsupported preparation descriptor schema");
  const actual = object(value.identity);
  if (actual.owner !== ownerName || Object.entries(expected).some(([key, item]) => actual[key] !== item))
    throw new Error("Preparation descriptor ownership/scene/build identity mismatch");
  if (!Number.isSafeInteger(value.preparationWorkerPid) || value.preparationWorkerPid < 1 ||
      value.preparationWorkerPid === expected.parentWorkerPid || value.browserStarted !== false || value.requestDisposed !== true)
    throw new Error("Preparation must finish in a separate API-only worker with its request disposed");
  const fixture = object(value.fixture);
  if (typeof object(fixture.canvas).id !== "string" || object(fixture.provider).provider !== "fake" ||
      !Array.isArray(fixture.assets) || !Array.isArray(fixture.runs) || !Array.isArray(fixture.imageIds) ||
      typeof value.catalogManifestSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.catalogManifestSha256) ||
      digest(JSON.stringify(value.fixture)) !== value.fixtureSha256)
    throw new Error("Preparation fixture descriptor failed its shape/Fake/SHA checks");
  return value;
}

async function assertOwnedServer(root: string, output: string, baseURL: string, expectedBuildId: string) {
  assertPreparationLoopback(baseURL);
  const canonicalRoot = await realpath(root);
  const canonicalOutput = await realpath(output);
  if (!childOf(canonicalRoot, canonicalOutput)) throw new Error("Preparation output must be inside the current owned evidence run");
  const server = object(JSON.parse(await readFile(join(canonicalRoot, "runtime-server.json"), "utf8")));
  if (server.buildId !== expectedBuildId || server.profileCopied !== false || !Number.isSafeInteger(server.pid) || Number(server.pid) < 1 ||
      typeof server.isolatedDataRoot !== "string" || !basename(server.isolatedDataRoot).startsWith("supercanvas-e2e-"))
    throw new Error("Preparation refuses a server without the P0 ephemeral-runtime ownership proof");
  process.kill(Number(server.pid), 0);
  const guard = await realpath(join(server.isolatedDataRoot, "loopback-only.cjs"));
  if (dirname(guard).toLowerCase() !== (await realpath(server.isolatedDataRoot)).toLowerCase()) throw new Error("Preparation network guard escapes owned temporary server data");
  return guard;
}

/** Child entry: validates parent proof before any fixture API or file loading. */
export async function readPreparationRequest(baseURL: string) {
  if (process.env.P0_MEMORY_PREPARE_ACTIVE !== "1") throw new Error("Preparation child requires its explicit parent invocation");
  const root = process.env.P0_MEMORY_OUTPUT_DIR;
  const output = process.env.P0_MEMORY_PREPARE_OUTPUT_DIR;
  const expectedBuildId = process.env.P0_MEMORY_EXPECTED_BUILD_ID;
  if (!root || !output || !expectedBuildId || process.env.PLAYWRIGHT_BASE_URL) throw new Error("Incomplete isolated preparation environment");
  await assertOwnedServer(root, output, baseURL, expectedBuildId);
  const identity = JSON.parse(await readFile(join(output, "preparation-owner.json"), "utf8")) as PreparationOwner;
  if (identity.owner !== ownerName || identity.nonce !== process.env.P0_MEMORY_PREPARE_NONCE ||
      identity.scenario !== process.env.P0_MEMORY_PREPARE_SCENARIO || identity.baseURL !== baseURL ||
      identity.expectedBuildId !== expectedBuildId || !Number.isSafeInteger(identity.parentWorkerPid) || identity.parentWorkerPid === process.pid)
    throw new Error("Preparation child owner/nonce/scene/parent mismatch");
  process.kill(identity.parentWorkerPid, 0);
  return { output, identity };
}

export async function writePreparedMemoryFixture(
  output: string, identity: PreparationOwner, fixture: MemoryFixture, catalogManifest: unknown,
) {
  const envelope: PreparedEnvelope = {
    schemaVersion: 1,
    identity, preparationWorkerPid: process.pid, preparedAt: new Date().toISOString(),
    catalogManifestSha256: memoryCatalogManifestDigest(catalogManifest), fixtureSha256: digest(JSON.stringify(fixture)), fixture,
    childMemory: process.memoryUsage(), browserStarted: false, requestDisposed: true,
  };
  const text = JSON.stringify(envelope);
  decodePreparedMemoryFixture(text, identity);
  await writeFile(join(output, descriptorName), text, { flag: "wx" });
}

/** Buffers and upload tracing die with this separate runner/worker before launch. */
export async function prepareMemoryFixtureInChild(baseURL: string, root: string, output: string, scenario: MemoryScenario) {
  const expectedBuildId = process.env.P0_MEMORY_EXPECTED_BUILD_ID;
  if (!expectedBuildId) throw new Error("Preparation requires the expected production build");
  const guard = await assertOwnedServer(root, output, baseURL, expectedBuildId);
  const identity: PreparationOwner = { owner: ownerName, nonce: randomUUID(), scenario,
    parentWorkerPid: process.pid, baseURL, expectedBuildId };
  await writeFile(join(output, "preparation-owner.json"), JSON.stringify(identity, null, 2), { flag: "wx" });
  const rendererRoot = fileURLToPath(new URL("../..", import.meta.url));
  const before = process.memoryUsage();
  let logs = "";
  const child = spawn(process.execPath, ["--require", guard, join(rendererRoot, "node_modules", "@playwright", "test", "cli.js"),
    "test", "--config=playwright.p0-prepare.config.ts"], {
    cwd: rendererRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_OPTIONS: "", P0_MEMORY_SOAK: "0", P0_MEMORY_RETENTION: "0", P0_MEMORY_PREPARE_CHILD: "0",
      P0_MEMORY_PREPARE_ACTIVE: "1", P0_MEMORY_PREPARE_NONCE: identity.nonce,
      P0_MEMORY_PREPARE_SCENARIO: scenario, P0_MEMORY_PREPARE_OUTPUT_DIR: output, P0_MEMORY_PREPARE_BASE_URL: baseURL },
  });
  const append = (value: Buffer) => { logs = `${logs}${value.toString("utf8")}`.slice(-16_000); };
  child.stdout?.on("data", append); child.stderr?.on("data", append);
  let timedOut = false;
  try {
    const code = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid && child.exitCode === null) {
          if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
          else child.kill("SIGTERM");
        }
      }, 180_000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", exitCode => { clearTimeout(timer); resolveExit(exitCode); });
    });
    if (timedOut || code !== 0) throw new Error(`Preparation child failed (${timedOut ? "timeout" : code}); see preparation-child.log`);
    const descriptor = join(output, descriptorName);
    if ((await stat(descriptor)).size > maximumDescriptorBytes) throw new Error("Preparation descriptor exceeds its small JSON budget");
    const prepared = decodePreparedMemoryFixture(await readFile(descriptor, "utf8"), identity);
    let workerAlive = true;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { process.kill(prepared.preparationWorkerPid, 0); } catch { workerAlive = false; break; }
      await new Promise(resolveTurn => setTimeout(resolveTurn, 50));
    }
    if (workerAlive) throw new Error("Preparation worker is still alive; refuse measurement with retained upload buffers");
    const evidence = { mode: "isolated API-only preparation process", runnerPid: child.pid, workerPid: prepared.preparationWorkerPid,
      childExited: true, requestDisposed: true, browserStarted: false, descriptorBytes: (await stat(descriptor)).size,
      fixtureSha256: prepared.fixtureSha256, parentBefore: before, parentAfter: process.memoryUsage(), childFinal: prepared.childMemory };
    await writeFile(join(output, "preparation-parent.json"), JSON.stringify(evidence, null, 2), { flag: "wx" });
    return { fixture: prepared.fixture, catalogManifestSha256: prepared.catalogManifestSha256, evidence };
  } finally { await writeFile(join(output, "preparation-child.log"), logs, { flag: "wx" }); }
}
