import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type Request, type Response } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freemem } from "node:os";
import sharp from "sharp";
import type { CanvasDocument } from "../components/types";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";
import { applyCanvasPerfSwitch, canvasPerfState, collectCanvasPerfHostState, flushCanvasPerfObservers, installCanvasPerfSwitch, probeCanvasPerfHitTesting, requestedCanvasPerfSwitch, resetCanvasPerfCounters } from "./helpers/canvas-perf-switches";
import { memorySampleValidity, minimumAvailableMemoryGiB, performanceMemoryEnvironment } from "./helpers/performance-environment";

type Fiber = { tag: number; flags: number; type?: { name?: string; displayName?: string; type?: { name?: string } }; child?: Fiber; sibling?: Fiber };
type Capture = { frames: number[]; longTasks: number[]; commits: number; renders: Record<string, number>; started: number; raf: number };
type PerfWindow = typeof window & {
  __uiPerf: Capture | null;
  __uiPerfStart: () => void;
  __uiPerfStop: () => Omit<Capture, "raf"> & { elapsed: number };
  __uiPerfTypes: Map<unknown, string>;
  __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown;
};

async function installCapture(page: Page) {
  await page.addInitScript(() => {
    const w = window as PerfWindow;
    w.__uiPerf = null;
    w.__uiPerfTypes = new Map();
    const observer = new PerformanceObserver(list => {
      if (w.__uiPerf) for (const entry of list.getEntries()) if (entry.startTime >= w.__uiPerf.started) w.__uiPerf.longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
    w.__uiPerfStart = () => {
      if (w.__uiPerf) cancelAnimationFrame(w.__uiPerf.raf);
      const capture: Capture = { frames: [], longTasks: [], commits: 0, renders: {}, started: performance.now(), raf: 0 };
      w.__uiPerf = capture;
      if ("__canvasPerfSwitch" in w) performance.mark("ui-perf-capture-start");
      let last = performance.now();
      const frame = (now: number) => { if (w.__uiPerf !== capture) return; capture.frames.push(now - last); last = now; capture.raf = requestAnimationFrame(frame); };
      capture.raf = requestAnimationFrame(frame);
    };
    w.__uiPerfStop = () => {
      const capture = w.__uiPerf!;
      cancelAnimationFrame(capture.raf);
      for (const entry of observer.takeRecords()) if (entry.startTime >= capture.started) capture.longTasks.push(entry.duration);
      w.__uiPerf = null;
      if ("__canvasPerfSwitch" in w) performance.mark("ui-perf-capture-end");
      return { ...capture, elapsed: performance.now() - capture.started };
    };
    const renderers = new Map<number, unknown>();
    let previous = new WeakSet<Fiber>();
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers,
      inject(renderer: unknown) { const id = renderers.size + 1; renderers.set(id, renderer); return id; },
      onCommitFiberRoot(_id: number, root: { current: Fiber }) {
        const capture = w.__uiPerf;
        const current = new WeakSet<Fiber>();
        if (capture) capture.commits++;
        const walk = (fiber?: Fiber) => {
          if (!fiber) return;
          current.add(fiber);
          // Bailouts can reuse an entire old subtree with old PerformedWork
          // flags. Count only fibers newly committed since the prior root.
          if (capture && !previous.has(fiber) && (fiber.flags & 1) !== 0 && [0, 1, 2, 11, 14, 15].includes(fiber.tag)) {
            const name = fiber.type?.displayName ?? fiber.type?.name ?? fiber.type?.type?.name ?? `tag-${fiber.tag}`;
            capture.renders[name] = (capture.renders[name] ?? 0) + 1;
            const semanticName = w.__uiPerfTypes.get(fiber.type);
            if (semanticName && semanticName !== name) capture.renders[semanticName] = (capture.renders[semanticName] ?? 0) + 1;
          }
          walk(fiber.child); walk(fiber.sibling);
        };
        walk(root.current);
        previous = current;
      },
      onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    };
  });
}

const output = process.env.UI_PERF_OUTPUT_DIR;
const phase = process.env.UI_PERF_PHASE ?? "sample";
const throttling = Number(process.env.UI_PERF_CPU_RATE ?? 4);
const iterations = Number(process.env.UI_PERF_ITERATIONS ?? 3);
// Extended A/B captures keep the original input cadence for ten seconds.
// The unchanged short baseline remains the default for Phase 1 floor comparisons.
const gestureDurationMs = Number(process.env.UI_PERF_GESTURE_MS ?? 0);
if (!Number.isFinite(gestureDurationMs) || gestureDurationMs < 0 || gestureDurationMs > 15_000) throw new Error("Invalid UI_PERF_GESTURE_MS");
const profileEnabled = process.env.UI_PERF_PROFILE === "1";
const profileTargets = new Set((process.env.UI_PERF_PROFILE_TARGETS ?? "model-picker-fake,asset-library").split(","));
const timelineEnabled = process.env.UI_PERF_TIMELINE === "1";
const selectorStatsEnabled = timelineEnabled && process.env.UI_PERF_SELECTOR_STATS === "1";
const layerDumpEnabled = process.env.UI_PERF_LAYER_TREE === "1";
const requestedTheme = process.env.UI_PERF_THEME;
if (requestedTheme && requestedTheme !== "light" && requestedTheme !== "dark") throw new Error("UI_PERF_THEME must be light or dark");

async function installPerformanceTheme(page: Page, theme = requestedTheme) {
  if (!theme) return;
  await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
  await page.addInitScript(value => localStorage.setItem("supercanvas:appearance", value), theme);
  if (process.env.UI_PERF_FROSTED_RADIUS === "12") await page.addInitScript(() => {
    const apply = () => { if (document.documentElement) document.documentElement.dataset.frostedRadius = "12"; };
    apply(); document.addEventListener("DOMContentLoaded", apply, { once: true });
  });
}

async function exposedPerformancePanePoint(page: Page) {
  const evidence = await page.locator(".react-flow__pane").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const describe = (target: Element | null) => target ? {
      tag: target.tagName, className: target.getAttribute("class"), role: target.getAttribute("role"),
      label: target.getAttribute("aria-label"),
    } : null;
    const legacyPoint = { x: bounds.x + bounds.width / 2, y: bounds.y + 16 };
    const candidates = [legacyPoint, ...[80, 112, bounds.height * .55, bounds.height * .75]
      .flatMap(y => [.5, .35, .25, .65].map(x => ({ x: bounds.x + bounds.width * x, y: bounds.y + y })))];
    const point = candidates.find(candidate => document.elementFromPoint(candidate.x, candidate.y) === element);
    return { point: point ?? null, legacyPoint, legacyHit: describe(document.elementFromPoint(legacyPoint.x, legacyPoint.y)),
      selectedHit: point ? describe(document.elementFromPoint(point.x, point.y)) : null,
      pane: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      viewportBefore: getComputedStyle(document.querySelector(".react-flow__viewport")!).transform };
  });
  expect(evidence.point, "Performance gesture must start on the real pane, clear of floating islands and panels").not.toBeNull();
  return { ...evidence, point: evidence.point! };
}


type CoreMatrixCombination = { id: string; theme: "light" | "dark"; frost: boolean };

/** One browser, one live page, one shared eight-image fixture. Opt-in only. */
async function runCorePerformanceMatrix(browser: Browser, request: APIRequestContext, baseURL: string) {
  if (!output) throw new Error("Core matrix requires UI_PERF_OUTPUT_DIR");
  if (minimumAvailableMemoryGiB !== 2.5) throw new Error("Core matrix requires explicit UI_PERF_MIN_RAM_GIB=2.5");
  await mkdir(output, { recursive: true });
  const models = [{ id: "fake-image-v1", name: "Fake", operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"], metadata: { canvasRunnable: true } }];
  const providerResponse = await request.post("/api/providers", { data: { name: "离线性能基准", provider: "fake", apiKey: "local-test-only",
    config: { usage: "canvas", defaultModel: "fake-image-v1", connector: { auth: { type: "none" }, models } } } });
  expect(providerResponse.ok()).toBeTruthy();
  const provider = await providerResponse.json();
  const imageIds: string[] = [];
  for (let i = 0; i < 8; i++) {
    const buffer = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: { r: 35 + i * 20, g: 70, b: 170 - i * 10 } } }).png().toBuffer();
    const uploaded = await request.post("/api/assets/upload", { multipart: { file: { name: `ui-perf-${i}.png`, mimeType: "image/png", buffer } } });
    expect(uploaded.ok()).toBeTruthy(); imageIds.push((await uploaded.json()).id);
  }
  const graph: CanvasDocument = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: Array.from({ length: 120 }, (_, i) => ({ id: `ui-perf-${i}`, type: "workflow", position: { x: (i % 12) * 440, y: Math.floor(i / 12) * 340 },
      style: { width: i % 3 === 2 ? 300 : 360, height: i % 3 === 2 ? 225 : 260 },
      data: i % 3 === 0 ? { nodeType: "prompt", label: `提示词 ${i}`, parts: [{ type: "text", text: "电影感森林与柔和晨光，画布流畅度基准" }],
        inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] }
        : i % 3 === 1 ? { nodeType: "image-generation", label: `图像生成 ${i}`, provider: "fake", connectionId: provider.id, model: "fake-image-v1", parameters: {}, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] }
        : { nodeType: "asset-input", label: `图片结果 ${i}`, assetId: imageIds[i % 8], assetKind: "image", generatedResult: true, generatedStatus: "succeeded", mediaAspectRatio: 4 / 3,
          generatedFromNodeId: `ui-perf-${i - 1}`, generatedModel: "fake-image-v1", inputs: [], outputs: [{ id: "image", kind: "image", label: "图片" }] },
    })),
    edges: Array.from({ length: 80 }, (_, i) => { const group = Math.floor(i / 2) * 3; return { id: `ui-perf-edge-${i}`, source: `ui-perf-${group + i % 2}`,
      target: `ui-perf-${group + i % 2 + 1}`, sourceHandle: i % 2 ? "images" : "prompt", targetHandle: i % 2 ? undefined : "prompt" }; }),
  };

  const created = await request.post("/api/canvas", { data: { title: "120 节点精简交替基准", graph } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json() as { id: string };
  const combinations: CoreMatrixCombination[] = [
    { id: "A", theme: "light", frost: true }, { id: "B", theme: "dark", frost: true },
    { id: "C", theme: "light", frost: false }, { id: "D", theme: "dark", frost: false },
  ];
  const coreGestures = new Set((process.env.UI_PERF_CORE_GESTURES ?? "drag,pan,zoom").split(","));
  if ([...coreGestures].some(name => !["drag", "pan", "zoom"].includes(name))) throw new Error("UI_PERF_CORE_GESTURES must contain drag, pan or zoom");
  const captureParameters = process.env.UI_PERF_CORE_PARAMETERS !== "0";
  const liveDocument = process.env.UI_PERF_CORE_LIVE === "1";
  let liveWarmupComplete = false;
  const attempts: Array<Record<string, unknown>> = [];
  const accepted: Array<Record<string, unknown>> = [];
  const externalRequests: string[] = [];
  let generationRequests = 0;
  const origin = new URL(baseURL).origin;
  const report = () => ({ phase: "core-matrix", timestamp: new Date().toISOString(),
    environment: "日常使用环境（低可用内存）", ...performanceMemoryEnvironment,
    browser: browser.version(), cpuRate: throttling, viewport: { width: 1600, height: 1000 },
    fixture: { nodes: 120, edges: 80, sourceImages: 8, sourceImage: "2048 × 1536", provider: "Fake" },
    sequence: liveDocument ? "ABCD × 5; one persistent live document; three warm parameter opens per arm" : "ABCD × 5; one document-first and two warm parameter opens per document; one persistent browser/context/page",
    cachePolicy: liveDocument ? "One unmeasured parameter opening before all arms; all timed openings are warm, not cold. No inter-arm navigation, storage reset or GC." : "A new document per arm resets application/module state; HTTP and V8 compilation caches remain warm in the same context",
    liveDocument,
    gestures: [...coreGestures], captureParameters,
    externalRequests, externalRequestCount: externalRequests.length, generationRequests, attempts, accepted });
  const partial = async () => writeFile(join(output, "core-matrix-partial.json"), JSON.stringify(report(), null, 2));
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 }, reducedMotion: "no-preference",
    extraHTTPHeaders: { "x-supercanvas-desktop-token": "supercanvas-isolated-e2e-session" } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (/^https?:/u.test(url) && new URL(url).origin !== origin) { externalRequests.push(url); await route.abort(); return; }
    if (new URL(url).pathname.startsWith("/api/runs") && route.request().method() === "POST") { generationRequests++; await route.abort(); return; }
    if (new URL(url).pathname === "/api/agent/turn") { await route.abort(); return; }
    await route.continue();
  });
  await page.route(`**/api/providers/${provider.id}/models*`, route => route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } }));
  await page.addInitScript(radius => {
    try { localStorage.setItem("supercanvas:appearance", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch { /* about:blank has no origin storage */ }
    if (radius === "12") {
      const apply = () => { if (document.documentElement) document.documentElement.dataset.frostedRadius = "12"; };
      apply(); document.addEventListener("DOMContentLoaded", apply, { once: true });
    }
  }, process.env.UI_PERF_FROSTED_RADIUS);
  await installCapture(page);
  process.env.UI_PERF_EFFECT = "frosted";
  process.env.UI_PERF_ARM = "A";
  await installCanvasPerfSwitch(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttling });
  try {
  for (let round = 1; round <= 5; round++) for (const combination of combinations) {
    let complete = false;
    for (let attempt = 0; attempt <= 3 && !complete; attempt++) {
      process.env.UI_PERF_EFFECT = "frosted";
      process.env.UI_PERF_ARM = combination.frost ? "A" : "B";
      if (!liveDocument) {
        const reset = await request.put(`/api/canvas/${canvas.id}`, { data: { graph } });
        expect(reset.ok(), "Reset the shared graph before each arm").toBeTruthy();
      }
      const rows: Array<Record<string, unknown>> = [];
      const errors: string[] = [];
      const warnings: string[] = [];
      const arm: Record<string, unknown> = { round, combination: combination.id, theme: combination.theme,
        frost: combination.frost, radius: process.env.UI_PERF_FROSTED_RADIUS === "12" ? 12 : 22,
        attempt, startedAt: new Date().toISOString(), rows, errors, warnings, valid: false };
      attempts.push(arm);
      let originalPromptTransform: string | undefined;
      const restoreLiveDrag = async () => {
        if (!liveDocument) return;
        const openPanel = page.getByRole("dialog", { name: "图像生成 1 模型与参数", exact: true });
        if (await openPanel.isVisible()) await openPanel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
        if (originalPromptTransform === undefined) return;
        await page.mouse.up();
        await page.mouse.up({ button: "middle" });
        const prompt = page.locator('.react-flow__node[data-id="ui-perf-0"]');
        const current = await prompt.evaluate(element => (element as HTMLElement).style.transform);
        if (current !== originalPromptTransform) {
          await page.keyboard.press("Control+z");
          await expect.poll(() => prompt.evaluate(element => (element as HTMLElement).style.transform)).toBe(originalPromptTransform);
        }
        arm.restoredPromptTransform = await prompt.evaluate(element => (element as HTMLElement).style.transform);
        expect(arm.restoredPromptTransform).toBe(originalPromptTransform);
        originalPromptTransform = undefined;
      };
      const recordError = (error: Error) => errors.push(error.message);
      const recordConsole = (message: import("@playwright/test").ConsoleMessage) => { if (["error", "warning"].includes(message.type())) warnings.push(`${message.type()}: ${message.text()}`); };
      page.on("pageerror", recordError);
      page.on("console", recordConsole);
      try {
        await page.emulateMedia({ colorScheme: combination.theme });
        if (!liveDocument || !page.url().startsWith(origin)) await page.goto(`/canvas/${canvas.id}`);
        if (liveDocument) await page.evaluate(theme => {
          const key = "supercanvas:appearance";
          const oldValue = localStorage.getItem(key);
          localStorage.setItem(key, theme);
          window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: theme, storageArea: localStorage }));
        }, combination.theme);
        await expect(page.locator('.react-flow__node[data-id="ui-perf-1"]')).toBeVisible();
        const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
        await expect(inspector).toBeVisible();
        await page.getByRole("button", { name: "Fit View", exact: true }).click();
        await page.waitForTimeout(1000);
        if ((await inspector.getAttribute("aria-expanded")) === "false") await inspector.click();
        await expect.poll(() => page.locator(".generated-result-node img").evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete))).toBe(true);
        await page.evaluate(arm => {
          (window as unknown as { __canvasPerfSwitch: { effect: string; arm: string } }).__canvasPerfSwitch = { effect: "frosted", arm };
        }, combination.frost ? "A" : "B");
        const gate = await applyCanvasPerfSwitch(page);
        arm.effectGate = gate;
        arm.loadedTheme = await page.locator("html").getAttribute("data-theme");
        expect(arm.loadedTheme).toBe(combination.theme);
        expect(gate?.config).toEqual({ effect: "frosted", arm: combination.frost ? "A" : "B" });
        let availableBeforeBytes = 0;
        let memoryWaitMs = 0;
        const start = async () => {
          const waitingSince = Date.now();
          while (!memorySampleValidity(freemem()) && Date.now() - waitingSince < 5000) await page.waitForTimeout(500);
          memoryWaitMs = Date.now() - waitingSince;
          availableBeforeBytes = freemem();
          if (!memorySampleValidity(availableBeforeBytes)) {
            arm.rejectedCaptureSystem = { availableBeforeBytes, ...performanceMemoryEnvironment, valid: false };
            throw new Error("RAM below 2.5 GiB before capture");
          }
          await resetCanvasPerfCounters(page);
          await page.evaluate(() => (window as PerfWindow).__uiPerfStart());
        };
        const stop = async (gesture: string, iteration = 0, duration?: number) => {
          const raw = await page.evaluate(() => (window as PerfWindow).__uiPerfStop());
          const availableAfterBytes = freemem();
          const system = { availableBeforeBytes, availableAfterBytes, ...performanceMemoryEnvironment,
            valid: memorySampleValidity(availableBeforeBytes, availableAfterBytes) };
          const frames = raw.frames.slice(1).sort((a, b) => a - b);
          rows.push({ gesture, iteration, system, memoryWaitMs, ...(duration === undefined ? {} : { interactiveMs: duration,
            openTemperature: liveDocument || iteration > 0 ? "warm" : "document-first" }),
            elapsed: raw.elapsed, frames: frames.length, frameP95: frames[Math.floor(frames.length * .95)] ?? 0,
            frameP50: frames[Math.floor(frames.length * .5)] ?? 0, frameMax: frames.at(-1) ?? 0,
            longTasks: raw.longTasks.length, longTaskMs: raw.longTasks.reduce((sum, value) => sum + value, 0), commits: raw.commits });
          await partial();
          if (!system.valid) throw new Error("RAM below 2.5 GiB after capture");
          await flushCanvasPerfObservers(page);
        };
        const interactive = async (trigger: Locator, ready: Locator, activation: "click" | "dblclick" = "click") => {
          // Browser timestamps exclude Playwright's click actionability overhead.
          const begin = await trigger.evaluate((element, eventType) => {
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (!bounds.width || !bounds.height || style.visibility === "hidden" || style.display === "none")
              throw new Error("Panel benchmark trigger must be visible at the current LOD");
            const now = performance.now();
            if (eventType === "dblclick") element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
            else (element as HTMLElement).click();
            return now;
          }, activation);
          await ready.waitFor({ state: "visible" });
          return ready.evaluate(async (element, clicked) => {
            await new Promise<void>(resolve => {
              const poll = () => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                const surface = element.closest('[role="dialog"], .agent-panel') ?? element;
                const loading = surface.matches('[data-panel-loading="true"]') || surface.querySelector('[data-panel-loading="true"]');
                if (!loading && element.isConnected && !(element as HTMLButtonElement).disabled && rect.width && rect.height && Number(style.opacity) >= .99 && (hit === element || element.contains(hit))) resolve(); else requestAnimationFrame(poll); }; poll();
            });
            // Confirm readiness across two paints: asynchronous descriptor work can
            // otherwise stall the main thread immediately after the control appears.
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return performance.now() - clicked;
          }, begin);
        };

        if (liveDocument && !liveWarmupComplete) {
          if ((await inspector.getAttribute("aria-expanded")) === "true") await inspector.click();
          await page.getByRole("button", { name: "Fit View", exact: true }).click(); await page.waitForTimeout(550);
          const panel = page.getByRole("dialog", { name: "图像生成 1 模型与参数", exact: true });
          await interactive(page.locator('.react-flow__node[data-id="ui-perf-1"] .node-head'), panel.getByRole("combobox", { name: "图像生成 1 模型", exact: true }), "dblclick");
          await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
          if ((await inspector.getAttribute("aria-expanded")) === "false") await inspector.click();
          liveWarmupComplete = true;
        }
        await page.getByRole("button", { name: "Fit View", exact: true }).click(); await page.waitForTimeout(550);
        if (coreGestures.has("drag")) {
        if (liveDocument) originalPromptTransform = await page.locator('.react-flow__node[data-id="ui-perf-0"]').evaluate(element => (element as HTMLElement).style.transform);
        const header = await page.locator('.react-flow__node[data-id="ui-perf-0"] .node-head').boundingBox(); expect(header).not.toBeNull();
        await page.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
        await start(); await page.mouse.down();
        for (let i = 1; i <= 60; i++) { await page.mouse.move(header!.x + header!.width / 2 + 60 * Math.sin(i / 15), header!.y + header!.height / 2 + i / 2); await page.waitForTimeout(12); }
        await page.mouse.up(); await stop("drag-agent-open");
        }
        if (coreGestures.has("pan")) {
        const pan = await exposedPerformancePanePoint(page);
        await page.mouse.move(pan.point.x, pan.point.y);
        await start(); await page.mouse.down({ button: "middle" });
        for (let i = 1; i <= 60; i++) { await page.mouse.move(pan.point.x + i, pan.point.y + i / 3); await page.waitForTimeout(12); }
        await page.mouse.up({ button: "middle" }); await stop("pan-agent-open");
        }
        if (coreGestures.has("zoom")) {
        const zoom = await exposedPerformancePanePoint(page);
        await page.mouse.move(zoom.point.x, zoom.point.y);
        await start();
        for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, i < 6 ? -60 : 60); await page.waitForTimeout(35); }
        await page.waitForTimeout(180); await stop("zoom-agent-open");
        }
        if ((await inspector.getAttribute("aria-expanded")) === "true") await inspector.click();
        await page.getByRole("button", { name: "Fit View", exact: true }).click(); await page.waitForTimeout(550);
        for (let iteration = 0; iteration < (captureParameters ? 3 : 0); iteration++) {
          const panel = page.getByRole("dialog", { name: "图像生成 1 模型与参数", exact: true });
          await start();
          const panelMs = await interactive(page.locator('.react-flow__node[data-id="ui-perf-1"] .node-head'), panel.getByRole("combobox", { name: "图像生成 1 模型", exact: true }), "dblclick");
          await stop("node-parameters", iteration, panelMs);
          await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
        }
        expect(generationRequests).toBe(0); expect(externalRequests).toEqual([]); expect(errors).toEqual([]);
        await restoreLiveDrag();
        arm.valid = true; accepted.push(arm); complete = true;
      } catch (error) {
        arm.failure = String(error);
        // Only memory pressure is eligible for the user-authorized retry budget.
        if (!String(error).includes("RAM below 2.5 GiB")) { arm.nonMemoryFailure = true; attempt = 3; }
      } finally {
        arm.finishedAt = new Date().toISOString();
        page.off("pageerror", recordError);
        page.off("console", recordConsole);
        if (liveDocument) {
          await restoreLiveDrag();
          arm.availableAfterLiveCleanupBytes = freemem();
        } else {
          await page.goto("about:blank");
          // Reset only this isolated origin's previous-arm recovery journal.
          // Otherwise its old revision conflicts with the next fixture PUT.
          await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,indexeddb" });
          // Collect only discarded test documents, before loading the next arm.
          // Never force GC in the application document or inside a capture.
          await cdp.send("HeapProfiler.collectGarbage");
          await page.waitForTimeout(350);
          arm.availableAfterDocumentReleaseBytes = freemem();
        }
        await partial();
      }
      console.log(JSON.stringify({ round, combination: combination.id, attempt, valid: arm.valid, failure: arm.failure, rows: rows.length, availableGiB: freemem() / 1024 ** 3 }));
    }
    if (!complete) console.log(`Core matrix ${round}/${combination.id} missing after retry budget; continuing ABCD sequence`);
  }
  } finally {
    await cdp.detach();
    await context.close();
    await writeFile(join(output, "core-matrix-results.json"), JSON.stringify(report(), null, 2));
  }
  expect(accepted).toHaveLength(20);
}

// Both opt-in benchmarks use temporary data and never submit generation. The
// canvas fixture uses Fake; the .invalid directory fixture exercises UI only.
// React's DevTools hook is injected by the test, never shipped with the product.
test.use({ viewport: { width: 1600, height: 1000 }, trace: output ? "off" : "on", video: "off" });
test("120 个混合节点的交互与主要面板性能基准", async ({ page, request, browser, baseURL }, testInfo) => {
  test.skip(!output, "Set UI_PERF_OUTPUT_DIR to collect this machine's baseline");
  test.setTimeout(480_000);
  if (process.env.UI_PERF_CORE_MATRIX === "1") {
    test.setTimeout(1_800_000);
    // Dispose the automatic blank-page fixture before the first matrix context.
    await page.context().close();
    await runCorePerformanceMatrix(browser, request, baseURL!);
    await testInfo.attach("core-matrix-performance", { path: join(output!, "core-matrix-results.json"), contentType: "application/json" });
    return;
  }
  await mkdir(output!, { recursive: true });
  await writeFile(join(output!, `${phase}-host-before.json`), JSON.stringify(await collectCanvasPerfHostState(), null, 2));
  const errors: string[] = [];
  const warnings: string[] = [];
  const initialNetwork: Array<Record<string, unknown>> = [];
  let stopInitialNetwork = () => {};
  if (process.env.UI_PERF_NETWORK_DIAGNOSTICS === "1") {
    const started = new Map<string, number>();
    const recordRequest = (request: Request) => { started.set(request.url(), Date.now()); initialNetwork.push({ event: "request", time: Date.now(), url: request.url(), method: request.method() }); };
    const recordFailure = (request: Request) => initialNetwork.push({ event: "failed", time: Date.now(), url: request.url(), failure: request.failure() });
    const recordResponse = (response: Response) => initialNetwork.push({ event: "response", time: Date.now(), url: response.url(), status: response.status(), elapsedMs: Date.now() - (started.get(response.url()) ?? Date.now()) });
    page.on("request", recordRequest); page.on("requestfailed", recordFailure); page.on("response", recordResponse);
    stopInitialNetwork = () => { page.off("request", recordRequest); page.off("requestfailed", recordFailure); page.off("response", recordResponse); };
  }
  let submissions = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) warnings.push(`${message.type()}: ${message.text()}`); });
  await page.route("**/api/runs**", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  await page.route("**/api/agent/turn", route => route.abort());
  await installPerformanceTheme(page);
  await installCapture(page);
  await installCanvasPerfSwitch(page);
  const models = [{ id: "fake-image-v1", name: "Fake", operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"], metadata: { canvasRunnable: true } }];
  const providerResponse = await request.post("/api/providers", { data: { name: "离线性能基准", provider: "fake", apiKey: "local-test-only",
    config: { usage: "canvas", defaultModel: "fake-image-v1", connector: { auth: { type: "none" }, models } } } });
  expect(providerResponse.ok()).toBeTruthy();
  const provider = await providerResponse.json();
  await page.route(`**/api/providers/${provider.id}/models*`, route => route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } }));
  const imageIds: string[] = [];
  for (let i = 0; i < 8; i++) {
    const buffer = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: { r: 35 + i * 20, g: 70, b: 170 - i * 10 } } }).png().toBuffer();
    const uploaded = await request.post("/api/assets/upload", { multipart: { file: { name: `ui-perf-${i}.png`, mimeType: "image/png", buffer } } });
    expect(uploaded.ok()).toBeTruthy(); imageIds.push((await uploaded.json()).id);
  }
  const graph: CanvasDocument = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: Array.from({ length: 120 }, (_, i) => ({ id: `ui-perf-${i}`, type: "workflow", position: { x: (i % 12) * 440, y: Math.floor(i / 12) * 340 },
      style: { width: i % 3 === 2 ? 300 : 360, height: i % 3 === 2 ? 225 : 260 },
      data: i % 3 === 0 ? { nodeType: "prompt", label: `提示词 ${i}`, parts: [{ type: "text", text: "电影感森林与柔和晨光，画布流畅度基准" }],
        inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] }
        : i % 3 === 1 ? { nodeType: "image-generation", label: `图像生成 ${i}`, provider: "fake", connectionId: provider.id, model: "fake-image-v1", parameters: {}, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] }
        : { nodeType: "asset-input", label: `图片结果 ${i}`, assetId: imageIds[i % 8], assetKind: "image", generatedResult: true, generatedStatus: "succeeded", mediaAspectRatio: 4 / 3,
          generatedFromNodeId: `ui-perf-${i - 1}`, generatedModel: "fake-image-v1", inputs: [], outputs: [{ id: "image", kind: "image", label: "图片" }] },
    })),
    edges: Array.from({ length: 80 }, (_, i) => { const group = Math.floor(i / 2) * 3; return { id: `ui-perf-edge-${i}`, source: `ui-perf-${group + i % 2}`,
      target: `ui-perf-${group + i % 2 + 1}`, sourceHandle: i % 2 ? "images" : "prompt", targetHandle: i % 2 ? undefined : "prompt" }; }),
  };
  const stateFixture = process.env.UI_PERF_STATE_FIXTURE === "1";
  if (stateFixture) {
    // Supplement only: the original baseline has no active queued/running
    // nodes. Never mix these samples into the unchanged formal 120-node floor.
    // A source's transient data.status is deliberately replaced by the live
    // status map. Persist pending status on existing result cards instead:
    // four running and two queued results also reflect onto their six sources,
    // yielding exactly eight running + four queued visible cards. These are
    // six supplemental task states, not twelve independently submitted runs.
    const pendingSince = new Date(Date.now() - 42_000).toISOString();
    for (const [index, result] of graph.nodes.filter(node => node.data.generatedResult === true).entries()) {
      if (index >= 6) break;
      result.data.generatedStatus = index < 4 ? "running" : "queued";
      result.data.generatedCreatedAt = pendingSince;
    }
  }
  const created = await request.post("/api/canvas", { data: { title: "120 节点离线性能基准", graph } });
  expect(created.ok()).toBeTruthy(); const canvas = await created.json();
  await page.goto(`/canvas/${canvas.id}`);
  try {
    await expect(page.locator('.react-flow__node[data-id="ui-perf-1"]')).toBeVisible();
  } catch (error) {
    stopInitialNetwork();
    const dom = await page.evaluate(() => ({ readyState: document.readyState, title: document.title, text: document.body.innerText,
      resources: performance.getEntriesByType("resource").map(entry => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, initiatorType: (entry as PerformanceResourceTiming).initiatorType })) })).catch(() => null);
    await writeFile(join(output!, `${phase}-initial-load-failure.json`), JSON.stringify({ errors, warnings, initialNetwork, dom, url: page.url() }, null, 2));
    throw error;
  }
  stopInitialNetwork();
  if (process.env.UI_PERF_NETWORK_DIAGNOSTICS === "1") {
    await writeFile(join(output!, `${phase}-initial-load-network.json`), JSON.stringify({ errors, warnings, initialNetwork, url: page.url() }, null, 2));
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttling });
  type CompositorLayer = { layerId: string; backendNodeId?: number; drawsContent?: boolean; width?: number; height?: number };
  let compositorLayers: CompositorLayer[] = [];
  if (layerDumpEnabled) {
    cdp.on("LayerTree.layerTreeDidChange", (event: { layers?: CompositorLayer[] }) => { compositorLayers = event.layers ?? []; });
    await cdp.send("LayerTree.enable");
  }
  const dumpLayers = async (label: string) => {
    if (!layerDumpEnabled) return;
    if (process.env.UI_PERF_LAYER_COUNTS_ONLY === "1") {
      await writeFile(join(output!, `${phase}-layers-${label}.json`), JSON.stringify(compositorLayers, null, 2));
      return;
    }
    const records = [];
    for (const layer of compositorLayers) {
      const reasons = await cdp.send("LayerTree.compositingReasons", { layerId: layer.layerId }).catch(() => ({}));
      const described = layer.backendNodeId ? await cdp.send("DOM.describeNode", { backendNodeId: layer.backendNodeId }).catch(() => ({ node: undefined })) : { node: undefined };
      const attributes = described.node?.attributes ?? [];
      const classIndex = attributes.indexOf("class"), idIndex = attributes.indexOf("id");
      records.push({ ...layer, ...reasons, nodeName: described.node?.nodeName, className: classIndex >= 0 ? attributes[classIndex + 1] : "", id: idIndex >= 0 ? attributes[idIndex + 1] : "" });
    }
    await writeFile(join(output!, `${phase}-layers-${label}.json`), JSON.stringify(records, null, 2));
  };
  let timelineComplete: Promise<{ stream?: string }> | null = null;
  const startDiagnostic = async (target: string, iteration: number) => {
    if ((!profileEnabled && !timelineEnabled) || iteration !== 0 || !profileTargets.has(target)) return;
    if (timelineEnabled) {
      timelineComplete = new Promise(resolve => cdp.once("Tracing.tracingComplete", resolve));
      await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,latencyInfo" +
        (selectorStatsEnabled ? ",disabled-by-default-blink.debug,disabled-by-default-devtools.timeline.invalidationTracking" : ""), transferMode: "ReturnAsStream" });
    }
    if (profileEnabled) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
  };
  const stopDiagnostic = async (target: string, iteration: number) => {
    if ((!profileEnabled && !timelineEnabled) || iteration !== 0 || !profileTargets.has(target)) return;
    if (profileEnabled) { const { profile } = await cdp.send("Profiler.stop"); await writeFile(join(output!, `${phase}-${target}.cpuprofile`), JSON.stringify(profile)); }
    if (timelineComplete) {
      await cdp.send("Tracing.end");
      const { stream } = await timelineComplete;
      if (!stream) throw new Error("Timeline recording did not return a stream");
      let trace = "";
      for (;;) {
        const part = await cdp.send("IO.read", { handle: stream });
        trace += part.base64Encoded ? Buffer.from(part.data, "base64").toString("utf8") : part.data;
        if (part.eof) break;
      }
      await cdp.send("IO.close", { handle: stream });
      await writeFile(join(output!, `${phase}-${target}.trace.json`), trace);
      timelineComplete = null;
    }
  };
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  await expect(inspector).toBeVisible();
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await page.waitForTimeout(1000);
  if (process.env.UI_PERF_DIAGNOSTIC_PAUSE_EDGES === "1") {
    await page.addStyleTag({ content: ".canvas-editor .studio-edge .studio-edge-dash { animation-play-state: paused !important; }" });
  }
  const promotionTargets = (process.env.UI_PERF_DIAGNOSTIC_PROMOTE ?? "").split(",").filter(name => ["nodes", "edges", "node"].includes(name));
  if (promotionTargets.length) {
    await page.addStyleTag({ content: `${promotionTargets.map(name => `.react-flow__${name}`).join(",")} { will-change: transform !important; }` });
  }
  if (process.env.UI_PERF_DIAGNOSTIC_CONTAIN_SETTINGS === "1") {
    await page.addStyleTag({ content: ".sm-settings-backdrop { contain: layout paint !important; }" });
  }
  if (process.env.UI_PERF_DIAGNOSTIC_PROMOTION_MODE === "selected") {
    await page.addStyleTag({ content: ".react-flow__viewport { will-change: transform !important; } .react-flow__node { will-change: auto !important; } .react-flow__node:is(.selected,.dragging) { will-change: transform !important; }" });
  }
  if (process.env.UI_PERF_DIAGNOSTIC_HIDE_GRID === "1") {
    await page.addStyleTag({ content: ".react-flow__background { display: none !important; }" });
  }
  if (process.env.UI_PERF_DIAGNOSTIC_STROKE_OPACITY === "1") {
    // Diagnostic only: an unfilled path can put alpha on its stroke instead of
    // creating a group-opacity effect, keeping its visible stroke unchanged.
    await page.addStyleTag({ content: ".canvas-editor .studio-edge .react-flow__edge-path { opacity: 1 !important; stroke-opacity: .45 !important; } .canvas-editor .studio-edge:is(:hover, .is-focused, .is-selected) .react-flow__edge-path { stroke-opacity: .9 !important; }" });
  }
  if (process.env.UI_PERF_DIAGNOSTIC_ISOLATE_EDGES === "1") {
    await page.addStyleTag({ content: ".canvas-editor .react-flow__edges { isolation: isolate !important; }" });
  }
  if ((await inspector.getAttribute("aria-expanded")) === "false") await inspector.click();
  await expect.poll(() => page.locator(".generated-result-node img").evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete))).toBe(true);
  const effectGate = await applyCanvasPerfSwitch(page);
  if (effectGate) await writeFile(join(output!, `${phase}-effect-gate.json`), JSON.stringify({ effectGate, stateFixture }, null, 2));
  if (stateFixture && effectGate) {
    expect(effectGate.state.statusCounts.running, "Supplement must actually render eight running nodes").toBe(8);
    expect(effectGate.state.statusCounts.queued, "Supplement must actually render four queued nodes").toBe(4);
  }
  if (process.env.UI_PERF_SKIP_SCREENSHOTS !== "1") await page.screenshot({ path: join(output!, `${phase}-canvas.png`) });
  if (layerDumpEnabled) await dumpLayers("initial");
  if (process.env.UI_PERF_SNAPSHOT_ONLY === "1") {
    const hitTest = await probeCanvasPerfHitTesting(page);
    expect(hitTest.geometry.nodes, "Selection must preserve all node/handle rectangles").toEqual(effectGate?.geometry.nodes);
    expect(hitTest.geometry.viewport, "Selection must preserve viewport geometry").toEqual(effectGate?.geometry.viewport);
    if (layerDumpEnabled) await dumpLayers("probe-selected");
    await writeFile(join(output!, `${phase}-gesture-diagnostic-results.json`), JSON.stringify({ phase, diagnosticOnly: true, snapshotOnly: true,
      profileEnabled, timelineEnabled, effectGate, stateFixture, hitTest, rows: [], errors, warnings }, null, 2));
    expect(submissions).toBe(0); expect(errors).toEqual([]);
    await cdp.detach();
    return;
  }
  const gestureHitTests: Array<Record<string, unknown>> = [];
  const rows: Array<Record<string, unknown>> = process.env.UI_PERF_RESUME_PANELS === "1"
    ? (JSON.parse(await readFile(join(output!, `${phase}-partial.json`), "utf8")) as { rows: Array<Record<string, unknown>> }).rows.filter(row => String(row.gesture).endsWith("agent-open")) : [];
  const owners = await page.evaluate(() => {
    // Memo wrappers can lose their names in production. Identify component type
    // objects by their own rendered DOM rather than guessing compressed names.
    const semanticSelectors = { AgentPanel: '.agent-panel', WorkflowNode: '.node-card', GenerationNodeBody: '.node-generation-body', CanvasEditor: '.canvas-wrap', Background: '.react-flow__background' };
    for (const [label, selector] of Object.entries(semanticSelectors)) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const key = Object.keys(element).find(value => value.startsWith("__reactFiber$"));
      let current = key ? (element as unknown as Record<string, { tag: number; type?: unknown; return?: unknown }>)[key] : undefined;
      while (current) {
        if ([0, 1, 2, 11, 14, 15].includes(current.tag)) { (window as PerfWindow).__uiPerfTypes.set(current.type, label); break; }
        current = current.return as typeof current;
      }
    }
    const selectors = { generation: '.node-card[data-node-type="image-generation"]', prompt: '.node-card[data-node-type="prompt"]', result: '.generated-result-node', agent: '.agent-panel', canvas: '.react-flow' };
    return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!element) return [name, []];
      const key = Object.keys(element).find(value => value.startsWith("__reactFiber$"));
      let fiber = key ? (element as unknown as Record<string, { return?: unknown }>)[key] : undefined;
      const stack: string[] = [];
      while (fiber) {
        const entry = fiber as { type?: { name?: string; displayName?: string; render?: { name?: string; displayName?: string }; type?: { name?: string } }; return?: typeof fiber };
        if (typeof entry.type !== "string") { const label = entry.type?.displayName || entry.type?.name || entry.type?.render?.displayName || entry.type?.render?.name || entry.type?.type?.name; if (label) stack.push(label); }
        fiber = entry.return;
      }
      return [name, stack];
    }));
  });
  let availableBeforeBytes = 0;
  const start = async () => {
    // Browser startup can briefly dip below the daily-use RAM floor. Wait
    // outside the timed interaction; never accept a sample below the floor.
    if (process.env.UI_PERF_WAIT_FOR_RAM === "1") {
      await expect.poll(() => freemem(), { timeout: 60_000, intervals: [1000] })
        .toBeGreaterThanOrEqual(performanceMemoryEnvironment.minimumAvailableMemoryBytes);
    }
    availableBeforeBytes = freemem();
    await resetCanvasPerfCounters(page);
    await page.evaluate(() => (window as PerfWindow).__uiPerfStart());
  };
  const stop = async (gesture: string, iteration: number, duration?: number) => {
    const raw = await page.evaluate(() => (window as PerfWindow).__uiPerfStop());
    const availableAfterBytes = freemem();
    const system = { availableBeforeBytes, availableAfterBytes, ...performanceMemoryEnvironment,
      valid: memorySampleValidity(availableBeforeBytes, availableAfterBytes) };
    const frames = raw.frames.slice(1).sort((a, b) => a - b);
    const effectState = requestedCanvasPerfSwitch() ? await canvasPerfState(page) : undefined;
    const row = { gesture, iteration, system, ...(duration === undefined ? {} : { interactiveMs: duration }), ...(effectState ? { effectState } : {}), elapsed: raw.elapsed,
      frames: frames.length, fps: frames.length / raw.elapsed * 1000, frameP50: frames[Math.floor(frames.length * .5)] ?? 0,
      frameP95: frames[Math.floor(frames.length * .95)] ?? 0, frameMax: frames.at(-1) ?? 0, framesOver50ms: frames.filter(x => x > 50).length,
      longTasks: raw.longTasks.length, longTaskMs: raw.longTasks.reduce((sum, value) => sum + value, 0), commits: raw.commits,
      renders: Object.fromEntries(Object.entries(raw.renders).sort((a, b) => b[1] - a[1])) };
    rows.push(row);
    await writeFile(join(output!, `${phase}-partial.json`), JSON.stringify({ phase, owners, rows, errors, warnings }, null, 2));
    expect(system.valid, `Performance sample requires available RAM >= ${minimumAvailableMemoryGiB} GiB at both capture boundaries (${performanceMemoryEnvironment.environmentLabel})`).toBe(true);
    await flushCanvasPerfObservers(page);
    console.log(JSON.stringify(row)); return row;
  };
  const interactive = async (trigger: Locator, ready: Locator, activation: "click" | "dblclick" = "click") => {
    // Browser timestamps exclude Playwright's click actionability overhead.
    const begin = await trigger.evaluate((element, eventType) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!bounds.width || !bounds.height || style.visibility === "hidden" || style.display === "none")
        throw new Error("Panel benchmark trigger must be visible at the current LOD");
      const now = performance.now();
      if (eventType === "dblclick") element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      else (element as HTMLElement).click();
      return now;
    }, activation);
    await ready.waitFor({ state: "visible" });
    return ready.evaluate(async (element, clicked) => {
      await new Promise<void>(resolve => {
        const poll = () => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          const surface = element.closest('[role="dialog"], .agent-panel') ?? element;
          const loading = surface.matches('[data-panel-loading="true"]') || surface.querySelector('[data-panel-loading="true"]');
          if (!loading && element.isConnected && !(element as HTMLButtonElement).disabled && rect.width && rect.height && Number(style.opacity) >= .99 && (hit === element || element.contains(hit))) resolve(); else requestAnimationFrame(poll); }; poll();
      });
      // Confirm readiness across two paints: asynchronous descriptor work can
      // otherwise stall the main thread immediately after the control appears.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - clicked;
    }, begin);
  };
  for (let iteration = 0; iteration < (process.env.UI_PERF_RESUME_PANELS === "1" || process.env.UI_PERF_PANELS_ONLY === "1" ? 0 : iterations); iteration++) {
    await page.getByRole("button", { name: "Fit View", exact: true }).click(); await page.waitForTimeout(550);
    const header = await page.locator('.react-flow__node[data-id="ui-perf-0"] .node-head').boundingBox(); expect(header).not.toBeNull();
    await page.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
    if (profileEnabled || timelineEnabled) await startDiagnostic("drag-agent-open", iteration);
    await start(); await page.mouse.down();
    const dragUntil = Date.now() + gestureDurationMs;
    for (let i = 1; i <= 60 || Date.now() < dragUntil; i++) { await page.mouse.move(header!.x + header!.width / 2 + 60 * Math.sin(i / 15), header!.y + header!.height / 2 + (gestureDurationMs ? 15 * (1 - Math.cos(i / 15)) : i / 2)); await page.waitForTimeout(12); }
    await page.mouse.up(); await stop("drag-agent-open", iteration);
    if (profileEnabled || timelineEnabled) await stopDiagnostic("drag-agent-open", iteration);
    if (layerDumpEnabled && iteration === 0) await dumpLayers("selected");
    const panHitTest = await exposedPerformancePanePoint(page);
    gestureHitTests.push({ gesture: "pan-agent-open", iteration, ...panHitTest });
    await writeFile(join(output!, `${phase}-gesture-hit-tests.json`), JSON.stringify(gestureHitTests, null, 2));
    const panStart = panHitTest.point;
    await page.mouse.move(panStart.x, panStart.y);
    if (profileEnabled || timelineEnabled) await startDiagnostic("pan-agent-open", iteration);
    await start(); await page.mouse.down({ button: "middle" });
    const panUntil = Date.now() + gestureDurationMs;
    for (let i = 1; i <= 60 || Date.now() < panUntil; i++) {
      await page.mouse.move(panStart.x + (gestureDurationMs ? 150 * Math.sin(i / 30) : i), panStart.y + (gestureDurationMs ? 40 * (1 - Math.cos(i / 30)) : i / 3)); await page.waitForTimeout(12);
      if (i === 1 && process.env.UI_PERF_DIAGNOSTIC_GESTURES_ONLY === "1" && !requestedCanvasPerfSwitch()) {
        const held = await page.evaluate(() => ({ interacting: document.querySelector(".canvas-wrap")?.classList.contains("is-interacting"),
          promotion: Object.fromEntries(["nodes", "edges", "node"].map(name => [name, Array.from(new Set(Array.from(document.querySelectorAll(`.react-flow__${name}`)).map(element => getComputedStyle(element).willChange)))])),
          edges: Array.from(document.querySelectorAll(".studio-edge-dash")).map(edge => ({ className: edge.getAttribute("class"), playState: getComputedStyle(edge).animationPlayState,
            animationName: getComputedStyle(edge).animationName, display: getComputedStyle(edge).display, parent: edge.parentElement?.getAttribute("class") })) }));
        await writeFile(join(output!, `${phase}-held-pan-${iteration}.json`), JSON.stringify(held, null, 2));
      }
    }
    await page.mouse.up({ button: "middle" }); await stop("pan-agent-open", iteration);
    if (process.env.UI_PERF_DIAGNOSTIC_GESTURES_ONLY === "1" && !requestedCanvasPerfSwitch()) {
      await page.evaluate(() => performance.mark("ui-perf-selected-idle-start"));
      await start(); await page.waitForTimeout(1000); await stop("selected-idle", iteration);
      await page.evaluate(() => performance.mark("ui-perf-selected-idle-end"));
    }
    if (profileEnabled || timelineEnabled) await stopDiagnostic("pan-agent-open", iteration);
    if (process.env.UI_PERF_DIAGNOSTIC_SKIP_ZOOM !== "1") {
      const zoomHitTest = await exposedPerformancePanePoint(page);
      gestureHitTests.push({ gesture: "zoom-agent-open", iteration, ...zoomHitTest });
      await writeFile(join(output!, `${phase}-gesture-hit-tests.json`), JSON.stringify(gestureHitTests, null, 2));
      await page.mouse.move(zoomHitTest.point.x, zoomHitTest.point.y);
      if (profileEnabled || timelineEnabled) await startDiagnostic("zoom-agent-open", iteration);
      await start();
      const zoomUntil = Date.now() + gestureDurationMs;
      for (let i = 0; i < 12 || (gestureDurationMs > 0 && (Date.now() < zoomUntil || i % 12 !== 0)); i++) { await page.mouse.wheel(0, i % 12 < 6 ? -60 : 60); await page.waitForTimeout(35); }
      await page.waitForTimeout(180); await stop("zoom-agent-open", iteration);
      if (profileEnabled || timelineEnabled) await stopDiagnostic("zoom-agent-open", iteration);
    }
    if (process.env.UI_PERF_DIAGNOSTIC_GESTURES_ONLY === "1" && requestedCanvasPerfSwitch()) {
      // Supplemental selected-idle sample follows the complete original action
      // sequence; no extra snapshot/DOM query is inserted inside the pan loop.
      await start(); await page.waitForTimeout(1000); await stop("selected-idle", iteration);
    }
  }
  if (process.env.UI_PERF_DIAGNOSTIC_GESTURES_ONLY === "1") {
    expect(submissions).toBe(0); expect(errors).toEqual([]);
    await writeFile(join(output!, `${phase}-gesture-diagnostic-results.json`), JSON.stringify({ phase, diagnosticOnly: true,
      profileEnabled, timelineEnabled, selectorStatsEnabled, effectGate, stateFixture, gestureDurationMs, cpuRate: throttling, ...performanceMemoryEnvironment, browser: page.context().browser()?.version(), fixture: { nodes: 120, edges: 80, sourceImage: "2048 × 1536", iterations }, owners, gestureHitTests, rows, errors, warnings }, null, 2));
    await cdp.detach();
    return;
  }
  // Closing the inspector gives the attached node panel its normal full canvas.
  if ((await inspector.getAttribute("aria-expanded")) === "true") await inspector.click();
  await page.getByRole("button", { name: "Fit View", exact: true }).click(); await page.waitForTimeout(550);
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (profileEnabled || timelineEnabled) await startDiagnostic("node-parameters", iteration);
    const panel = page.getByRole("dialog", { name: "图像生成 1 模型与参数", exact: true });
    try {
    await start();
    // At far zoom the model footer is intentionally hidden. Activate the visible
    // header's equivalent action without changing the graph, viewport or timing.
    const panelMs = await interactive(page.locator('.react-flow__node[data-id="ui-perf-1"] .node-head'), panel.getByRole("combobox", { name: "图像生成 1 模型", exact: true }), "dblclick");
    await stop("node-parameters", iteration, panelMs);
    } finally {
      // Retain diagnostic evidence even when the RAM gate rejects the sample.
      if (profileEnabled || timelineEnabled) await stopDiagnostic("node-parameters", iteration);
    }
    if (iteration === 0) await page.screenshot({ path: join(output!, `${phase}-parameters.png`) });
    if (profileEnabled || timelineEnabled) await startDiagnostic("model-picker-fake", iteration);
    await start();
    const modelMs = await interactive(panel.getByRole("combobox", { name: "图像生成 1 模型", exact: true }), panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }));
    await stop("model-picker-fake", iteration, modelMs);
    if (profileEnabled || timelineEnabled) await stopDiagnostic("model-picker-fake", iteration);
    await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(2);
    if (iteration === 0) await page.screenshot({ path: join(output!, `${phase}-model-picker.png`) });
    await page.keyboard.press("Escape"); await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
    if (profileEnabled || timelineEnabled) await startDiagnostic("settings-supplier-ui", iteration);
    await start(); const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
    const settingsMs = await interactive(page.getByRole("button", { name: "API 设置", exact: false }), settings.getByPlaceholder("搜索名称或地址", { exact: true }));
    await stop("settings-supplier-ui", iteration, settingsMs);
    if (profileEnabled || timelineEnabled) await stopDiagnostic("settings-supplier-ui", iteration);
    if (iteration === 0) await page.screenshot({ path: join(output!, `${phase}-settings.png`) });
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    if (profileEnabled || timelineEnabled) await startDiagnostic("asset-library", iteration);
    await start();
    const assetsMs = await interactive(page.getByRole("button", { name: "打开节点与素材库", exact: true }), page.getByRole("button", { name: "关闭节点库", exact: true }));
    await stop("asset-library", iteration, assetsMs);
    if (profileEnabled || timelineEnabled) await stopDiagnostic("asset-library", iteration);
    if (iteration === 0) await page.screenshot({ path: join(output!, `${phase}-assets.png`) });
    await page.getByRole("button", { name: "关闭节点库", exact: true }).click();
    if (profileEnabled || timelineEnabled) await startDiagnostic("task-center", iteration);
    await start(); const tasks = page.getByRole("dialog", { name: "运行历史", exact: true });
    const tasksMs = await interactive(page.getByRole("button", { name: "打开任务中心", exact: true }), tasks.getByRole("button", { name: "关闭", exact: true }));
    await stop("task-center", iteration, tasksMs);
    if (profileEnabled || timelineEnabled) await stopDiagnostic("task-center", iteration);
    if (iteration === 0) await page.screenshot({ path: join(output!, `${phase}-tasks.png`) });
    await tasks.getByRole("button", { name: "关闭", exact: true }).click();
    if (profileEnabled || timelineEnabled) await startDiagnostic("agent-panel", iteration);
    await start(); const agentMs = await interactive(inspector, page.getByRole("textbox", { name: "创作任务要求", exact: true }));
    await stop("agent-panel", iteration, agentMs);
    if (profileEnabled || timelineEnabled) await stopDiagnostic("agent-panel", iteration);
    if (iteration === 0) await page.screenshot({ path: join(output!, `${phase}-agent.png`) });
    await inspector.click();
  }
  await page.locator('.react-flow__node[data-id="ui-perf-1"] .node-head').click();
  await page.getByRole("button", { name: /定位所选/ }).click();
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "打开 图像生成 1 模型与参数", exact: true }).click();
  await page.screenshot({ path: join(output!, `${phase}-parameters-detail.png`) });
  expect(submissions).toBe(0); expect(errors).toEqual([]);
  const savedDocument = await (await request.get(`/api/canvas/${canvas.id}`)).json();
  const sampleParameters = savedDocument.graph.nodes.find((node: { id: string }) => node.id === "ui-perf-1")?.data.parameters;
  const report = { phase, requestedTheme, profileEnabled, timelineEnabled, effectGate, stateFixture, timestamp: new Date().toISOString(), browser: page.context().browser()?.version(), cpuRate: throttling, ...performanceMemoryEnvironment, viewport: { width: 1600, height: 1000 }, sampleParameters,
    fixture: { nodes: 120, prompt: 40, imageGeneration: 40, imageResults: 40, edges: 80, sourceImage: "2048 × 1536", models: 1, provider: "Fake", iterations, libraryAssets: 8, tasks: 0 }, owners, gestureHitTests, rows, errors, warnings };
  const reportPath = join(output!, `${phase}-results.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await testInfo.attach("canvas-ui-performance", { path: reportPath, contentType: "application/json" });
  await cdp.detach();
});

test("5000 个模拟型号的菜单压力基准（仅 UI，禁止生成）", async ({ page, request }, testInfo) => {
  test.skip(!output, "Set UI_PERF_OUTPUT_DIR to collect this machine's baseline");
  test.setTimeout(360_000);
  await mkdir(output!, { recursive: true });
  await installPerformanceTheme(page);
  await installCapture(page);
  let submissions = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/runs**", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  // This synthetic .invalid connection exercises UI descriptors only. No real
  // supplier credentials or endpoint are loaded and every run is intercepted.
  const models = Array.from({ length: 5000 }, (_, i) => ({ id: `ui-only-image-${i}`, name: `模拟图片型号 ${i}`,
    operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"], metadata: { canvasRunnable: true } }));
  const providerResponse = await request.post("/api/providers", { data: { name: "UI 压力模拟目录", provider: "rest", apiKey: "not-a-real-key",
    config: { usage: "canvas", baseUrl: "https://ui-perf.invalid", defaultModel: models[0]!.id, connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [models[0]] } } } });
  expect(providerResponse.ok(), await providerResponse.text()).toBeTruthy(); const provider = await providerResponse.json();
  await page.route(`**/api/providers/${provider.id}/models*`, route => route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } }));
  const response = await request.post("/api/canvas", { data: { title: "5000 型号 UI 压力基准", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [],
    nodes: [{ id: "directory-stress", type: "workflow", position: { x: 180, y: 160 }, style: { width: 420, height: 240 }, data: {
      nodeType: "image-generation", label: "目录压力", provider: "rest", connectionId: provider.id, model: models[0]!.id, parameters: {}, parts: [],
      inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }],
    } }],
  } } });
  expect(response.ok()).toBeTruthy(); const canvas = await response.json();
  await page.goto(`/canvas/${canvas.id}`);
  await expect(page.getByRole("button", { name: "打开 目录压力 模型与参数", exact: true })).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttling });
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  if ((await inspector.getAttribute("aria-expanded")) === "true") await inspector.click();
  await page.waitForTimeout(750);
  await page.getByRole("button", { name: "打开 目录压力 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "目录压力 模型与参数", exact: true });
  const picker = panel.getByRole("combobox", { name: "目录压力 模型", exact: true });
  await expect(picker).toBeVisible();
  const rows: Array<Record<string, unknown> & { system: { availableBeforeBytes: number; availableAfterBytes: number;
    minimumAvailableMemoryBytes: number; valid: boolean } }> = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const availableBeforeBytes = freemem();
    await page.evaluate(() => (window as PerfWindow).__uiPerfStart());
    if (profileEnabled && iteration === 0) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    const begin = await picker.evaluate(element => { const now = performance.now(); (element as HTMLElement).click(); return now; });
    const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
    await search.waitFor({ state: "visible" });
    const interactiveMs = await search.evaluate(async (element, clicked) => {
      const rect = element.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (hit !== element && !element.contains(hit)) throw new Error("Model search is obstructed");
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - clicked;
    }, begin);
    // A total count assertion prevents the Fake provider's one-model shortcut
    // from being accidentally reported as a large menu measurement.
    await expect(panel.getByRole("listbox").getByRole("option").first()).toHaveAttribute("aria-setsize", "5001");
    expect(await panel.getByRole("listbox").getByRole("option").count()).toBeLessThanOrEqual(40);
    const raw = await page.evaluate(() => (window as PerfWindow).__uiPerfStop());
    const availableAfterBytes = freemem();
    const system = { availableBeforeBytes, availableAfterBytes, ...performanceMemoryEnvironment,
      valid: memorySampleValidity(availableBeforeBytes, availableAfterBytes) };
    rows.push({ gesture: "model-picker-5000", iteration, system, interactiveMs, elapsed: raw.elapsed, commits: raw.commits,
      longTasks: raw.longTasks.length, longTaskMs: raw.longTasks.reduce((sum, value) => sum + value, 0), renders: raw.renders });
    await writeFile(join(output!, `${phase}-directory-5000-partial.json`), JSON.stringify({ phase,
      ...performanceMemoryEnvironment, performanceValid: rows.every(row => row.system.valid), rows, errors }, null, 2));
    console.log(JSON.stringify(rows.at(-1)));
    if (iteration === 0) {
      if (profileEnabled) { const { profile } = await cdp.send("Profiler.stop"); await writeFile(join(output!, `${phase}-directory-5000.cpuprofile`), JSON.stringify(profile)); }
      await page.screenshot({ path: join(output!, `${phase}-directory-5000.png`) });
    }
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  }
  await picker.click(); const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
  await search.fill("ui-only-image-4999");
  await panel.getByRole("listbox").getByRole("option", { name: "模拟图片型号 4999", exact: true }).click();
  await expect(picker).toContainText("模拟图片型号 4999");
  expect(submissions).toBe(0); expect(errors).toEqual([]);
  const reportPath = join(output!, `${phase}-directory-5000-results.json`);
  await writeFile(reportPath, JSON.stringify({ phase, profileEnabled, cpuRate: throttling, browser: page.context().browser()?.version(),
    fixture: { nodes: 1, models: 5000, selectableTotalWithAuto: 5001, operation: "UI only, 0 generation submissions" },
    ...performanceMemoryEnvironment, performanceValid: rows.every(row => row.system.valid), rows, errors }, null, 2));
  await testInfo.attach("directory-ui-performance", { path: reportPath, contentType: "application/json" });
  await cdp.detach();
  expect(rows.every(row => row.system.valid),
    `Performance samples require available RAM >= ${minimumAvailableMemoryGiB} GiB at both capture boundaries (${performanceMemoryEnvironment.environmentLabel}); invalid partial measurements were retained`).toBe(true);
});
