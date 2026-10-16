import { writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { join } from "node:path";

type DriverMemory = NodeJS.MemoryUsage & { availableSystemBytes: number };
export type DriverMemoryRuntime = {
  pid: number; nodeVersion: string; execArgvExposeGc: boolean; nodeOptionsExposeGc: boolean;
  capture: () => DriverMemory;
  nextTurn: () => Promise<void>;
  collect?: () => void;
};

export function readDriverGcMode(value = process.env.P0_MEMORY_DRIVER_GC): boolean {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("P0_MEMORY_DRIVER_GC must be 0 or 1");
}

function currentDriver(): DriverMemoryRuntime {
  const collect = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  return {
    pid: process.pid, nodeVersion: process.version,
    execArgvExposeGc: process.execArgv.some(value => /^--expose[-_]gc(?:=|$)/u.test(value)),
    nodeOptionsExposeGc: /(?:^|\s)--expose[-_]gc(?:\s|=|$)/u.test(process.env.NODE_OPTIONS ?? ""),
    capture: () => ({ ...process.memoryUsage(), availableSystemBytes: freemem() }),
    nextTurn: () => new Promise(resolve => setImmediate(resolve)),
    collect: typeof collect === "function" ? () => collect() : undefined,
  };
}

/** Call only after request.dispose(), before launching the renderer. */
export async function reclaimFixtureDriverMemory(
  output: string,
  enabled = readDriverGcMode(),
  runtime: DriverMemoryRuntime = currentDriver(),
) {
  const before = runtime.capture();
  let calls = 0;
  let status: "disabled" | "collected" | "unavailable" | "failed" = enabled ? "unavailable" : "disabled";
  let failure: unknown;
  if (enabled && runtime.collect) {
    // Let disposed channel callbacks release their temporary Buffer references.
    // This only yields Node's loop; there is no browser/Page/CDP dependency here.
    await runtime.nextTurn();
    try {
      calls++;
      runtime.collect();
      status = "collected";
    } catch (error) { status = "failed"; failure = error; }
    await runtime.nextTurn();
  }
  const report = {
    timestamp: new Date().toISOString(), boundary: "fixture-request-disposed-before-renderer-launch",
    process: { pid: runtime.pid, nodeVersion: runtime.nodeVersion, role: "Playwright measurement worker only",
      execArgvExposeGc: runtime.execArgvExposeGc, nodeOptionsExposeGc: runtime.nodeOptionsExposeGc },
    enabled, gcFunctionAvailable: Boolean(runtime.collect), gcCalls: calls, status,
    rendererGcRequested: false, before, after: runtime.capture(),
    interpretation: "Driver-only fixture preparation cleanup. RSS may retain allocator pages; this is not a renderer heap/native-memory sample or evidence of a product leak.",
  };
  await writeFile(join(output, "driver-preparation-memory.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  if (enabled && status === "unavailable")
    throw new Error("P0 driver GC requested but worker global.gc is unavailable; launch Playwright with node --expose-gc and verify worker inheritance");
  if (failure) throw failure;
  return report;
}
