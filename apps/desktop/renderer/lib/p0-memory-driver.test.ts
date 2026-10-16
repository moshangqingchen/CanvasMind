import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDriverGcMode, reclaimFixtureDriverMemory, type DriverMemoryRuntime } from "../e2e/helpers/p0-memory-driver";

let output: string;
beforeEach(async () => { output = await mkdtemp(join(tmpdir(), "supercanvas-p0-driver-test-")); });
afterEach(async () => {
  const path = resolve(output);
  if (!path.toLowerCase().startsWith(`${resolve(tmpdir()).toLowerCase()}${sep}`) || !path.includes("supercanvas-p0-driver-test-"))
    throw new Error("Refuse cleanup outside the owned P0 test temporary directory");
  await rm(path, { recursive: true, force: true });
});

function fakeRuntime(): DriverMemoryRuntime {
  return { pid: 123, nodeVersion: "test", execArgvExposeGc: true, nodeOptionsExposeGc: false,
    capture: vi.fn(() => ({ rss: 20, heapTotal: 10, heapUsed: 5, external: 4, arrayBuffers: 3, availableSystemBytes: 9 * 1024 ** 3 })),
    nextTurn: vi.fn(async () => {}), collect: vi.fn(),
  };
}

describe("P0 fixture driver GC", () => {
  it("is opt-in and rejects ambiguous flag values", () => {
    expect(readDriverGcMode("0")).toBe(false);
    expect(readDriverGcMode("1")).toBe(true);
    expect(() => readDriverGcMode("yes")).toThrow("must be 0 or 1");
  });
  it("collects exactly once in the driver and records bounded before/after memory", async () => {
    const runtime = fakeRuntime();
    const result = await reclaimFixtureDriverMemory(output, true, runtime);
    expect(runtime.collect).toHaveBeenCalledTimes(1);
    expect(runtime.nextTurn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "collected", gcCalls: 1, rendererGcRequested: false,
      process: { pid: 123, execArgvExposeGc: true }, before: { arrayBuffers: 3 }, after: { arrayBuffers: 3 } });
    expect(JSON.parse(await readFile(join(output, "driver-preparation-memory.json"), "utf8"))).toEqual(result);
  });
  it("leaves GC untouched when disabled and refuses an unavailable requested GC", async () => {
    const runtime = fakeRuntime();
    const result = await reclaimFixtureDriverMemory(output, false, runtime);
    expect(result.status).toBe("disabled");
    expect(runtime.collect).not.toHaveBeenCalled();
    expect(runtime.nextTurn).not.toHaveBeenCalled();
    await rm(join(output, "driver-preparation-memory.json"));
    await expect(reclaimFixtureDriverMemory(output, true, { ...runtime, collect: undefined })).rejects.toThrow("worker global.gc is unavailable");
    expect(JSON.parse(await readFile(join(output, "driver-preparation-memory.json"), "utf8"))).toMatchObject({ status: "unavailable", gcCalls: 0 });
  });
  it("inherits --expose-gc through the same Node fork default used by Playwright workers", async () => {
    const child = join(output, "worker.cjs");
    const parent = join(output, "runner.cjs");
    await writeFile(child, "process.send({available:typeof global.gc==='function',flag:process.execArgv.includes('--expose-gc')});process.disconnect();");
    await writeFile(parent, `const{fork}=require('node:child_process');const p=fork(${JSON.stringify(child)},{stdio:['ignore','ignore','ignore','ipc']});p.once('message',v=>process.stdout.write(JSON.stringify(v)));p.once('error',()=>process.exitCode=1);p.once('exit',c=>{if(c)process.exitCode=c});`);
    const result = await promisify(execFile)(process.execPath, ["--expose-gc", parent], { windowsHide: true, timeout: 10_000 });
    expect(JSON.parse(result.stdout)).toEqual({ available: true, flag: true });
  });
});
