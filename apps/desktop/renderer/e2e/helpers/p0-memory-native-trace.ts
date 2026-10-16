import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { join } from "node:path";
import type { CDPSession } from "@playwright/test";
import { windowsProcessMemory } from "./p0-memory-metrics";

type Label = "start" | "idle-end" | "operations-end";
type Boundary = {
  timestamp: string;
  availableMemoryBytes: number;
  renderer: Awaited<ReturnType<typeof windowsProcessMemory>>;
  jsHeap: { usedBytes: number; totalBytes: number; embedderHeapUsedBytes?: number; backingStorageBytes?: number };
};
type Dump = { label: Label; requestedAt: string; rendererPid: number; dumpGuid: string | null;
  success: boolean; error: string | null; before: Boundary | null; after: Boundary | null;
  samplerBoundary: unknown };
type Complete = { stream?: string; dataLossOccurred: boolean; traceFormat?: string; streamCompression?: string };

export function readNativeMemoryTraceMode() {
  const value = process.env.P0_MEMORY_NATIVE_TRACE;
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("P0_MEMORY_NATIVE_TRACE must be 0 or 1");
}

// Explicit empty memoryDumpConfig disables periodic dumps. In Chromium's
// TraceConfig parser it clears triggers while allowing all detail levels.
// No JS stack sampling, screenshot category, deterministic GC or heap snapshot.
export const nativeMemoryTraceOptions = {
  transferMode: "ReturnAsStream" as const, streamFormat: "json" as const, streamCompression: "none" as const,
  traceConfig: { recordMode: "recordUntilFull" as const, traceBufferSizeInKb: 16 * 1024,
    enableSampling: false, enableSystrace: false,
    includedCategories: ["disabled-by-default-memory-infra"], excludedCategories: ["*"], memoryDumpConfig: {} },
};

/** Diagnostic arm only. Failed/unsupported dumps remain errors, never measurements. */
export class NativeMemoryTrace {
  private active = false;
  private finished = false;
  private startedAt: string | null = null;
  private endedAt: string | null = null;
  private rendererStartedAt: string | null = null;
  private trace: { file: string; bytes: number; sha256: string; dataLossOccurred: boolean } | null = null;
  private readonly dumps: Dump[] = [];
  private readonly errors: string[] = [];
  constructor(private readonly cdp: CDPSession, private readonly output: string, private readonly rendererPid: number) {}

  snapshot() {
    return { enabled: true, diagnosticOnly: true, startedAt: this.startedAt, endedAt: this.endedAt,
      rendererPid: this.rendererPid, options: nativeMemoryTraceOptions, dumps: this.dumps, trace: this.trace, errors: this.errors,
      valid: this.finished && this.errors.length === 0 && this.trace !== null && !this.trace.dataLossOccurred &&
        ["start", "idle-end", "operations-end"].every(label => this.dumps.some(dump => dump.label === label && dump.success)),
      addedRendererGcCalls: 0, addedHeapSnapshots: 0,
      interpretation: "Memory-infra is additional instrumentation, not a no-leak verdict. Compare the same renderer PID and dump GUID. Windows private bytes are private commit; they are not live JS bytes. Inspect allocator committed/resident versus allocated objects and named Skia/CC/discardable/web caches if this Chromium exposes them. Missing fields are unknown. Allocator sizes overlap; do not sum raw sizes across owners. Effective sizes account for ownership. Tracing has its own overhead.",
      sources: [
        "https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json",
        "https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory-infra/README.md",
        "https://raw.githubusercontent.com/chromium/chromium/main/base/trace_event/trace_config.cc",
      ],
    };
  }

  private async save() {
    await writeFile(join(this.output, "native-memory-trace.json"), JSON.stringify(this.snapshot(), null, 2));
  }

  async start() {
    if (this.active || this.finished) throw new Error("Native memory trace cannot be restarted");
    try {
      if (!Number.isSafeInteger(this.rendererPid) || this.rendererPid < 1) throw new Error("Invalid native trace renderer PID");
      await this.cdp.send("Tracing.start", nativeMemoryTraceOptions);
      this.active = true;
      this.startedAt = new Date().toISOString();
    } catch (error) {
      this.errors.push(`Tracing.start: ${String(error)}`);
    }
    await this.save();
  }

  private async boundary(): Promise<Boundary> {
    const timestamp = new Date().toISOString();
    const availableMemoryBytes = freemem();
    const [heap, renderer] = await Promise.all([
      this.cdp.send("Runtime.getHeapUsage"), windowsProcessMemory(this.rendererPid),
    ]);
    return { timestamp, availableMemoryBytes, renderer,
      jsHeap: { usedBytes: heap.usedSize, totalBytes: heap.totalSize,
        embedderHeapUsedBytes: heap.embedderHeapUsedSize, backingStorageBytes: heap.backingStorageSize } };
  }

  async dump(label: Label, samplerBoundary: unknown) {
    const row: Dump = { label, requestedAt: new Date().toISOString(), rendererPid: this.rendererPid,
      dumpGuid: null, success: false, error: null, before: null, after: null, samplerBoundary };
    this.dumps.push(row);
    try {
      if (!this.active || this.finished) throw new Error("Memory-infra tracing is not active");
      row.before = await this.boundary();
      if (this.rendererStartedAt !== null && this.rendererStartedAt !== row.before.renderer.startedAt)
        throw new Error("Renderer PID identity changed between dumps");
      this.rendererStartedAt = row.before.renderer.startedAt;
      const dump = await this.cdp.send("Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" });
      row.dumpGuid = dump.dumpGuid;
      row.success = dump.success;
      row.after = await this.boundary();
      if (!dump.success) throw new Error("Tracing.requestMemoryDump returned success=false");
      if (!dump.dumpGuid) throw new Error("Tracing.requestMemoryDump returned no dump GUID");
      if (row.before.renderer.startedAt !== row.after.renderer.startedAt) throw new Error("Renderer PID identity changed across dump");
    } catch (error) {
      row.success = false;
      row.error = String(error);
      this.errors.push(`${label}: ${row.error}`);
    }
    await this.save();
  }

  async stop() {
    if (this.finished) return this.snapshot();
    this.finished = true;
    let stream: string | undefined;
    if (this.active) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let receive: (event: Complete) => void = () => undefined;
      const completion = new Promise<Complete>((resolve, reject) => {
        receive = resolve;
        timer = setTimeout(() => reject(new Error("Tracing.tracingComplete timeout")), 30_000);
      });
      // Avoid an unhandled rejection if the command itself fails first.
      void completion.catch(() => undefined);
      // Attach before end: tracingComplete can arrive before the command reply.
      this.cdp.on("Tracing.tracingComplete", receive);
      try {
        await Promise.race([this.cdp.send("Tracing.end"), completion.then(() => undefined)]);
        const complete = await completion;
        stream = complete.stream;
        if (!stream) throw new Error("Tracing.tracingComplete returned no stream");
        if (complete.traceFormat && complete.traceFormat !== "json") throw new Error(`Unexpected trace format: ${complete.traceFormat}`);
        if (complete.streamCompression && complete.streamCompression !== "none") throw new Error(`Unexpected trace compression: ${complete.streamCompression}`);
        const file = "native-memory-infra.trace.json";
        const handle = await open(join(this.output, file), "wx");
        const hash = createHash("sha256");
        let bytes = 0;
        try {
          while (true) {
            const chunk = await this.cdp.send("IO.read", { handle: stream, size: 64 * 1024 });
            const data = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
            bytes += data.byteLength;
            if (bytes > 64 * 1024 * 1024) throw new Error("Native trace stream exceeded 64 MiB diagnostic limit");
            await handle.writeFile(data); hash.update(data);
            if (chunk.eof) break;
          }
        } finally { await handle.close(); }
        this.trace = { file, bytes, sha256: hash.digest("hex"), dataLossOccurred: complete.dataLossOccurred };
        if (complete.dataLossOccurred) throw new Error("Tracing reported dataLossOccurred=true");
        if (!bytes) throw new Error("Native trace stream is empty");
      } catch (error) {
        this.errors.push(`Trace export: ${String(error)}`);
      } finally {
        if (timer) clearTimeout(timer);
        this.cdp.off("Tracing.tracingComplete", receive);
        if (stream) await this.cdp.send("IO.close", { handle: stream }).catch(error => { this.errors.push(`IO.close: ${String(error)}`); });
        this.active = false;
      }
    }
    this.endedAt = new Date().toISOString();
    await this.save();
    return this.snapshot();
  }
}
