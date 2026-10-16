import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CDPSession } from "@playwright/test";
import { NativeMemoryTrace, nativeMemoryTraceOptions, readNativeMemoryTraceMode } from "../e2e/helpers/p0-memory-native-trace";

vi.mock("../e2e/helpers/p0-memory-metrics", () => ({
  windowsProcessMemory: vi.fn(async (pid: number) => ({
    pid, name: "fake-renderer", startedAt: "2026-10-15T00:00:00.000Z",
    privateBytes: 300 * 1024 ** 2, workingSetBytes: 200 * 1024 ** 2, cpuSeconds: 1, handles: 10,
  })),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function session(options: { startError?: boolean; dumpFailure?: boolean; dataLoss?: boolean; noStream?: boolean } = {}) {
  const events = new EventEmitter();
  let guid = 0;
  const send = vi.fn(async (method: string) => {
    if (method === "Tracing.start" && options.startError) throw new Error("unsupported memory-infra");
    if (method === "Runtime.getHeapUsage") return { usedSize: 8 * 1024 ** 2, totalSize: 16 * 1024 ** 2 };
    if (method === "Tracing.requestMemoryDump") return { dumpGuid: `0x${++guid}`, success: !options.dumpFailure };
    if (method === "Tracing.end") queueMicrotask(() => events.emit("Tracing.tracingComplete", {
      stream: options.noStream ? undefined : "fake-stream", dataLossOccurred: Boolean(options.dataLoss),
      traceFormat: "json", streamCompression: "none",
    }));
    if (method === "IO.read") return { data: Buffer.from('{"traceEvents":[]}').toString("base64"), base64Encoded: true, eof: true };
    return {};
  });
  return { cdp: Object.assign(events, { send }) as unknown as CDPSession, send, events };
}

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "supercanvas-native-trace-unit-"));
  directories.push(path);
  return path;
}

describe("optional native memory diagnostic", () => {
  it("is off by default and rejects an ambiguous flag", () => {
    vi.stubEnv("P0_MEMORY_NATIVE_TRACE", undefined);
    expect(readNativeMemoryTraceMode()).toBe(false);
    vi.stubEnv("P0_MEMORY_NATIVE_TRACE", "0");
    expect(readNativeMemoryTraceMode()).toBe(false);
    vi.stubEnv("P0_MEMORY_NATIVE_TRACE", "1");
    expect(readNativeMemoryTraceMode()).toBe(true);
    vi.stubEnv("P0_MEMORY_NATIVE_TRACE", "yes");
    expect(readNativeMemoryTraceMode).toThrow("must be 0 or 1");
  });

  it("records labelled GUID/PID and JS/private boundaries, streams output and closes its handle without added GC", async () => {
    const output = await directory();
    const { cdp, send, events } = session();
    const trace = new NativeMemoryTrace(cdp, output, 12345);
    await trace.start();
    for (const label of ["start", "idle-end", "operations-end"] as const) await trace.dump(label, { phase: label, kind: "post-gc" });
    const result = await trace.stop();
    expect(result.valid).toBe(true);
    expect(result.dumps.map(dump => [dump.label, dump.dumpGuid, dump.rendererPid])).toEqual([
      ["start", "0x1", 12345], ["idle-end", "0x2", 12345], ["operations-end", "0x3", 12345],
    ]);
    expect(result.dumps[0]?.before?.jsHeap.usedBytes).toBe(8 * 1024 ** 2);
    expect(result.dumps[0]?.after?.renderer.privateBytes).toBe(300 * 1024 ** 2);
    expect(send).toHaveBeenCalledWith("Tracing.start", nativeMemoryTraceOptions);
    expect(send).toHaveBeenCalledWith("Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" });
    expect(send).toHaveBeenCalledWith("IO.close", { handle: "fake-stream" });
    expect(send.mock.calls.some(([method]) => method.startsWith("HeapProfiler."))).toBe(false);
    expect(nativeMemoryTraceOptions.traceConfig.memoryDumpConfig).toEqual({});
    expect(await readFile(join(output, "native-memory-infra.trace.json"), "utf8")).toBe('{"traceEvents":[]}');
    expect(JSON.parse(await readFile(join(output, "native-memory-trace.json"), "utf8")).valid).toBe(true);
    await trace.stop();
    expect(send.mock.calls.filter(([method]) => method === "Tracing.end")).toHaveLength(1);
    expect(events.listenerCount("Tracing.tracingComplete")).toBe(0);
  });

  it("does not stop someone else's trace when its own start is unsupported", async () => {
    const output = await directory();
    const { cdp, send } = session({ startError: true });
    const trace = new NativeMemoryTrace(cdp, output, 12345);
    await trace.start(); await trace.dump("start", null);
    const result = await trace.stop();
    expect(result.valid).toBe(false);
    expect(result.dumps[0]?.success).toBe(false);
    expect(result.errors.join("\n")).toContain("unsupported memory-infra");
    expect(send.mock.calls.some(([method]) => method === "Tracing.end")).toBe(false);
    expect(result.trace).toBeNull();
  });

  for (const option of ["dumpFailure", "dataLoss", "noStream"] as const) {
    it(`keeps ${option} evidence explicitly invalid`, async () => {
      const output = await directory();
      const { cdp, events } = session({ [option]: true });
      const trace = new NativeMemoryTrace(cdp, output, 12345);
      await trace.start();
      for (const label of ["start", "idle-end", "operations-end"] as const) await trace.dump(label, null);
      const result = await trace.stop();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      if (option === "dumpFailure") expect(result.dumps.every(dump => !dump.success)).toBe(true);
      expect(events.listenerCount("Tracing.tracingComplete")).toBe(0);
    });
  }
});
