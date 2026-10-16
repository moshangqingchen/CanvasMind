import { execFile } from "node:child_process";
import { appendFile, mkdir, open, writeFile } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CDPSession, Page, Request } from "@playwright/test";
import { sampleEdgeEffects } from "./p0-edge-effects";
import { minimumAvailableMemoryBytes } from "./performance-environment";

const execFileAsync = promisify(execFile);
export const minimumAvailableBytes = minimumAvailableMemoryBytes;

/** Scalar-only instrumentation: no media, object URL or DOM node is retained. */
export async function installMediaDiagnostics(page: Page) {
  await page.addInitScript(() => {
    const counters = { objectURLsCreated: 0, objectURLsRevoked: 0, imageDecodeCalls: 0, imageLoads: 0, imageErrors: 0,
      mediaMetadataLoads: 0, mediaLoads: 0, getImageDataCalls: 0, getImageDataRequestedPixels: 0, srcMutations: 0,
      nodeInsertions: 0, nodeRemovals: 0 };
    (window as typeof window & { __p0MediaCounters: typeof counters }).__p0MediaCounters = counters;
    // Only scalar event counts: distinguish accidental input in the isolated
    // native window from application-driven viewport/media changes during idle.
    const input = { pointerDown: 0, wheel: 0, keyDown: 0, untrusted: 0 };
    (window as typeof window & { __p0InputCounters: typeof input }).__p0InputCounters = input;
    document.addEventListener("pointerdown", event => { if (event.isTrusted) input.pointerDown++; else input.untrusted++; }, { capture: true, passive: true });
    document.addEventListener("wheel", event => { if (event.isTrusted) input.wheel++; else input.untrusted++; }, { capture: true, passive: true });
    document.addEventListener("keydown", event => { if (event.isTrusted) input.keyDown++; else input.untrusted++; }, { capture: true, passive: true });
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = function (...args) { counters.objectURLsCreated++; return create.apply(this, args); };
    URL.revokeObjectURL = function (...args) { counters.objectURLsRevoked++; return revoke.apply(this, args); };
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (...args) { counters.imageDecodeCalls++; return decode.apply(this, args); };
    const pixels = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args: Parameters<typeof pixels>) {
      counters.getImageDataCalls++; counters.getImageDataRequestedPixels += Math.abs(args[2] * args[3]);
      return pixels.apply(this, args);
    };
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement) counters.imageLoads++;
    }, true);
    document.addEventListener("error", event => {
      if (event.target instanceof HTMLImageElement) counters.imageErrors++;
    }, true);
    document.addEventListener("loadedmetadata", event => { if (event.target instanceof HTMLMediaElement) counters.mediaMetadataLoads++; }, true);
    document.addEventListener("loadeddata", event => { if (event.target instanceof HTMLMediaElement) counters.mediaLoads++; }, true);
    const matches = (node: Node) => node instanceof Element ? Number(node.matches(".react-flow__node")) + node.querySelectorAll(".react-flow__node").length : 0;
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes") counters.srcMutations++;
        else {
          for (const node of record.addedNodes) counters.nodeInsertions += matches(node);
          for (const node of record.removedNodes) counters.nodeRemovals += matches(node);
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
  });
}

export async function installAuraDiagnostics(page: Page) {
  await page.addInitScript(() => {
    const counters = { clears: 0, gradients: 0, drawCallbacks: 0, drawCallbackTotalMs: 0, drawCallbackMaxMs: 0,
      drawCallbackBinsTenthsMs: Array<number>(101).fill(0) };
    (window as typeof window & { __p0AuraCounters: typeof counters }).__p0AuraCounters = counters;
    const requestFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = function (callback) {
      return requestFrame.call(window, timestamp => {
        const before = counters.clears, started = performance.now();
        callback.call(window, timestamp);
        if (counters.clears === before) return;
        const elapsed = performance.now() - started;
        counters.drawCallbacks++;
        counters.drawCallbackTotalMs += elapsed;
        counters.drawCallbackMaxMs = Math.max(counters.drawCallbackMaxMs, elapsed);
        counters.drawCallbackBinsTenthsMs[Math.min(100, Math.floor(elapsed * 10))]++;
      });
    };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    const gradient = CanvasRenderingContext2D.prototype.createLinearGradient;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.closest("[data-animating]")) counters.clears++;
      return clear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.createLinearGradient = function (...args) {
      if (this.canvas.closest("[data-animating]")) counters.gradients++;
      return gradient.apply(this, args);
    };
  });
}

export async function probeAuraActivity(page: Page) {
  return page.evaluate(async () => {
    const counters = () => ({ ...(window as typeof window & { __p0AuraCounters?: { clears: number; gradients: number } }).__p0AuraCounters });
    const host = document.querySelector<HTMLElement>("[data-animating]");
    const canvas = host?.querySelector("canvas");
    const before = counters();
    const started = performance.now();
    const intersection = host ? await new Promise<{ observed: boolean; isIntersecting?: boolean; ratio?: number }>(resolve => {
      const observer = new IntersectionObserver(([entry]) => {
        clearTimeout(timer); observer.disconnect();
        resolve({ observed: true, isIntersecting: entry?.isIntersecting, ratio: entry?.intersectionRatio });
      }, { threshold: 0.05 });
      const timer = setTimeout(() => { observer.disconnect(); resolve({ observed: false }); }, 2000);
      observer.observe(host);
    }) : { observed: false };
    await new Promise(resolve => setTimeout(resolve, 500));
    const after = counters();
    return { visibilityState: document.visibilityState, hidden: document.hidden, focused: document.hasFocus(),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, dataAnimating: host?.dataset.animating ?? null,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null, intersection,
      elapsedMs: performance.now() - started, before, after, clearDelta: (after.clears ?? 0) - (before.clears ?? 0), gradientDelta: (after.gradients ?? 0) - (before.gradients ?? 0),
    };
  });
}

export async function windowsProcessMemory(pid: number) {
  if (process.platform !== "win32") throw new Error("This evidence requires Windows PrivateMemorySize64");
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid OS process PID");
  const script = `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.Refresh();
    @{ pid=$p.Id; name=$p.ProcessName; startedAt=$p.StartTime.ToUniversalTime().ToString('o');
      privateBytes=[long]$p.PrivateMemorySize64; workingSetBytes=[long]$p.WorkingSet64;
      cpuSeconds=$p.TotalProcessorTime.TotalSeconds; handles=$p.HandleCount } | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 10_000, maxBuffer: 16_000 });
  return JSON.parse(stdout) as { pid: number; name: string; startedAt: string; privateBytes: number; workingSetBytes: number; cpuSeconds: number; handles: number };
}

/** Unique page mark -> trace OS pid -> CDP renderer list. No Chrome-total proxy. */
export async function mapChromeRenderer(page: Page, browserCdp: CDPSession, output: string, sequence: number) {
  const marker = `p0-renderer-${process.pid}-${Date.now()}-${sequence}`;
  const chunks: Array<{ name: string; pid: number; [key: string]: unknown }> = [];
  const collect = (event: { value: unknown[] }) => {
    for (const value of event.value) {
      // CDP's generic trace dictionary type omits numeric pid. Validate the
      // actual event rather than asserting a stronger protocol payload type.
      if (typeof value !== "object" || value === null || !("name" in value) || typeof value.name !== "string" ||
          !("pid" in value) || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid)) continue;
      chunks.push({ ...value, name: value.name, pid: value.pid });
    }
  };
  browserCdp.on("Tracing.dataCollected", collect);
  const completed = new Promise<void>(resolve => browserCdp.once("Tracing.tracingComplete", () => resolve()));
  try {
    await browserCdp.send("Tracing.start", { categories: "blink.user_timing", transferMode: "ReportEvents" });
    await page.evaluate(name => { performance.mark(name); performance.clearMarks(name); }, marker);
    await browserCdp.send("Tracing.end");
    await completed;
  } finally { browserCdp.off("Tracing.dataCollected", collect); }
  const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
  const matches = chunks.filter(event => event.name === marker);
  const pids = [...new Set(matches.map(event => event.pid))];
  await writeFile(join(output, `renderer-map-${sequence}.json`), JSON.stringify({ marker, matches, processInfo }, null, 2));
  if (pids.length !== 1 || !processInfo.some(item => item.type === "renderer" && item.id === pids[0]))
    throw new Error(`Cannot uniquely map page renderer: ${JSON.stringify(pids)}`);
  return { pid: pids[0]!, method: "unique page performance.mark trace pid + SystemInfo renderer cross-check", processInfo };
}

export function observeNetwork(page: Page) {
  const counts = { requests: 0, responses: 0, failed: 0, inFlight: 0, mainFrameNavigations: 0, frameNavigations: 0 };
  const byEndpoint: Record<string, number> = {};
  const media = { previewRequests: 0, originalRequests: 0, repeatedMediaRequests: 0, uniqueMediaURLs: 0, uniqueTrackingOverflow: 0 };
  const previewSizes: Record<string, number> = {};
  const seenMedia = new Set<string>();
  // WeakSet prevents the observer retaining Playwright Request objects.
  const pending = new WeakSet<Request>();
  const request = (req: Request) => {
    counts.requests++; counts.inFlight++; pending.add(req);
    const url = new URL(req.url());
    if (/^\/api\/assets\/[^/]+\/(preview|content)$/.test(url.pathname)) {
      if (url.pathname.endsWith("/preview")) {
        media.previewRequests++;
        const tier = url.searchParams.get("size") ?? "default";
        if (Object.keys(previewSizes).length < 30 || tier in previewSizes) previewSizes[tier] = (previewSizes[tier] ?? 0) + 1;
      } else media.originalRequests++;
      const key = `${url.pathname}${url.search}`;
      if (seenMedia.has(key)) media.repeatedMediaRequests++;
      else if (seenMedia.size < 2048) { seenMedia.add(key); media.uniqueMediaURLs++; }
      else media.uniqueTrackingOverflow++;
    }
    const key = `${req.method()} ${url.pathname.replace(/\/[0-9a-f-]{32,}/giu, "/:id")}`;
    if (Object.keys(byEndpoint).length < 256 || key in byEndpoint) byEndpoint[key] = (byEndpoint[key] ?? 0) + 1;
  };
  const finished = (req: Request) => { if (pending.delete(req)) counts.inFlight--; };
  const failed = (req: Request) => { counts.failed++; finished(req); };
  const response = () => { counts.responses++; };
  const navigated = (frame: ReturnType<Page["mainFrame"]>) => {
    counts.frameNavigations++; if (frame === page.mainFrame()) counts.mainFrameNavigations++;
  };
  page.on("request", request); page.on("requestfinished", finished); page.on("requestfailed", failed);
  page.on("response", response); page.on("framenavigated", navigated);
  return {
    snapshot: () => ({ ...counts, byEndpoint: { ...byEndpoint }, media: { ...media, previewSizes: { ...previewSizes } } }),
    dispose: () => {
      page.off("request", request); page.off("requestfinished", finished); page.off("requestfailed", failed);
      page.off("response", response); page.off("framenavigated", navigated);
    },
  };
}

export async function takeHeapSnapshot(cdp: CDPSession, path: string) {
  // CDP chunks go directly to disk; no whole-snapshot Buffer in the test worker.
  const file = await open(path, "wx");
  let bytes = 0;
  let writes = Promise.resolve();
  const onChunk = ({ chunk }: { chunk: string }) => {
    bytes += Buffer.byteLength(chunk);
    writes = writes.then(async () => { await file.write(chunk); });
  };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  const started = Date.now();
  try {
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: true });
    await writes;
  } finally {
    cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    try { await writes; } finally { await file.close(); }
  }
  return { path, bytes, durationMs: Date.now() - started, forcedGcBeforeSnapshot: true };
}

export class MemorySampler {
  private sequence = 0;
  private readonly started = Date.now();
  private readonly rendererIdentities = new Map<number, string>();
  private lastIdleAuraClears: number | null = null;
  readonly invalidReasons = new Set<string>();
  readonly rows: Array<Record<string, unknown>> = [];
  constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly output: string,
    private readonly renderer: () => Promise<{ pid: number; method: string; surfaceState?: Record<string, unknown> }>,
    private readonly network: ReturnType<typeof observeNetwork>,
  ) {}

  async initialize() {
    await mkdir(this.output, { recursive: true });
    await this.cdp.send("Performance.enable");
    await this.cdp.send("HeapProfiler.enable");
  }

  async sample(phase: string, kind: "raw" | "post-gc" = "raw") {
    const started = Date.now();
    const availableMemoryBytes = freemem();
    if (availableMemoryBytes < minimumAvailableBytes) this.invalidReasons.add("available-memory-below-6-GiB");
    const mapping = await this.renderer();
    const [performance, dom, heap, native, visibility, edgeEffects] = await Promise.all([
      this.cdp.send("Performance.getMetrics"), this.cdp.send("Memory.getDOMCounters"),
      this.cdp.send("Runtime.getHeapUsage"), windowsProcessMemory(mapping.pid),
      this.page.evaluate(() => ({ visibilityState: document.visibilityState, hidden: document.hidden, focused: document.hasFocus(), url: location.pathname,
        input: { ...(window as typeof window & { __p0InputCounters?: Record<string, number> }).__p0InputCounters },
        idleInputGuard: { ...(window as typeof window & { __p0IdleInputGuard?: { blocked: boolean; prevented: number } }).__p0IdleInputGuard },
        canvasView: document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? null,
        media: {
          counters: { ...(window as typeof window & { __p0MediaCounters?: Record<string, number> }).__p0MediaCounters },
          images: Array.from(document.images).reduce((result, img) => {
            result.total++; if (img.complete) result.complete++; if (img.naturalWidth) result.decoded++;
            result.naturalPixels += img.naturalWidth * img.naturalHeight;
            if (img.naturalWidth >= 3840 || img.naturalHeight >= 3840) result.atLeast4k++;
            return result;
          }, { total: 0, complete: 0, decoded: 0, naturalPixels: 0, atLeast4k: 0 }),
          video: document.querySelectorAll("video").length, audio: document.querySelectorAll("audio").length,
          mediaReady: Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio")).filter(media => media.readyState >= 1).length,
          mediaPlaying: Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio")).filter(media => !media.paused).length,
          canvasBackingPixels: Array.from(document.querySelectorAll("canvas")).reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
          workflowNodes: document.querySelectorAll(".react-flow__node").length,
          selectedNodes: document.querySelectorAll(".react-flow__node.selected").length,
          focusedEdges: document.querySelectorAll(".studio-edge.is-focused").length,
          edgeMasks: document.querySelectorAll(".studio-edge mask").length,
          edgeBeams: document.querySelectorAll(".studio-edge-beam").length,
          runningEdgeLights: Array.from(document.querySelectorAll(".studio-edge-light")).filter(edge => getComputedStyle(edge).animationPlayState === "running").length,
        },
        aura: { dataAnimating: document.querySelector<HTMLElement>("[data-animating]")?.dataset.animating ?? null,
          counters: { ...(window as typeof window & { __p0AuraCounters?: { clears: number; gradients: number } }).__p0AuraCounters },
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches } })),
      sampleEdgeEffects(this.page),
    ]);
    const previousIdentity = this.rendererIdentities.get(mapping.pid);
    if (previousIdentity && previousIdentity !== native.startedAt) this.invalidReasons.add("renderer-pid-reused");
    this.rendererIdentities.set(mapping.pid, native.startedAt);
    if (this.rendererIdentities.size > 1) this.invalidReasons.add("renderer-identity-changed");
    if (process.env.P0_MEMORY_SURFACE === "native-windowed" && (visibility.hidden || !visibility.focused))
      this.invalidReasons.add("owned-native-window-not-visible-and-focused");
    if (phase === "idle" && visibility.aura.dataAnimating !== null) {
      const clears = visibility.aura.counters.clears ?? 0;
      const paused = process.env.P0_MEMORY_AURA === "paused";
      if (paused ? visibility.aura.dataAnimating !== "false" || (this.lastIdleAuraClears !== null && clears !== this.lastIdleAuraClears)
        : visibility.aura.dataAnimating !== "true" || (this.lastIdleAuraClears !== null && clears <= this.lastIdleAuraClears))
        this.invalidReasons.add(paused ? "aura-not-paused-during-idle" : "aura-not-drawing-during-idle");
      this.lastIdleAuraClears = clears;
    }
    const availableAfter = freemem();
    if (availableAfter < minimumAvailableBytes) this.invalidReasons.add("available-memory-below-6-GiB");
    const metrics = Object.fromEntries(performance.metrics.map(item => [item.name, item.value]));
    const row = {
      sequence: this.sequence++, timestamp: new Date(started).toISOString(), elapsedMs: started - this.started,
      phase, kind, samplingDurationMs: Date.now() - started,
      system: { availableMemoryBytes, availableAfterBytes: availableAfter, totalMemoryBytes: totalmem(), minimumAvailableMemoryBytes },
      renderer: { ...native, mappingMethod: mapping.method },
      surfaceState: mapping.surfaceState ?? null,
      jsHeap: { usedBytes: heap.usedSize, totalBytes: heap.totalSize, embedderHeapUsedBytes: heap.embedderHeapUsedSize, backingStorageBytes: heap.backingStorageSize },
      dom, performance: metrics, visibility, edgeEffects, network: this.network.snapshot(),
      valid: this.invalidReasons.size === 0, invalidReasons: [...this.invalidReasons],
    };
    this.rows.push(row);
    await appendFile(join(this.output, "samples.jsonl"), `${JSON.stringify(row)}\n`);
    return row;
  }

  async checkpoint(label: string) {
    await this.sample(label, "raw");
    await this.cdp.send("HeapProfiler.collectGarbage");
    await this.sample(label, "post-gc");
    const snapshot = await takeHeapSnapshot(this.cdp, join(this.output, `${label}.post-gc.heapsnapshot`));
    await appendFile(join(this.output, "snapshots.jsonl"), `${JSON.stringify({ label, ...snapshot })}\n`);
    // Snapshot machinery itself can inflate native memory; record its boundary.
    await this.sample(`${label}-after-snapshot`, "raw");
  }
}
