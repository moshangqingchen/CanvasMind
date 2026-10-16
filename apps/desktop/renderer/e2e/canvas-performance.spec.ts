import { test as base, expect, type APIRequestContext, type ConsoleMessage } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { freemem } from "node:os";
import sharp from "sharp";
import type { CanvasDocument } from "../components/types";
import { clickBlankCanvas } from "./canvas-test-actions";

type NodeChurn = { initial: number; minimum: number; peak: number; final: number; added: number; removed: number };
type ZoomAudit = { wheels: Array<{ time: number; eventTime: number; deltaY: number; interacting: boolean }>;
  classes: Array<{ time: number; host: string; before: string | null; after: string | null }> };
type MeasuredWindow = typeof window & { __frames: number[]; __measure: boolean; __stopNodeChurn?: () => NodeChurn; __stopZoomAudit?: () => ZoomAudit };
type Scene = "prompt" | "mixed";
type Measurement = { scene: Scene; count: number; gesture: string; samples: number; p50: number; p95: number; max: number; over50ms: number;
  nodeChurn?: NodeChurn;
  zoomAudit?: ZoomAudit;
  system: { availableBeforeBytes: number; availableAfterBytes: number; minimumAvailableMemoryBytes: number; valid: boolean } };

// These historical frame gates deliberately disable expensive action traces.
// Event-only evidence does not take DOM snapshots or change any gesture/timing.
const test = base.extend<{ consoleEvidence: void }>({
  consoleEvidence: [async ({ page }, runFixture, testInfo) => {
    const events: Array<Record<string, unknown>> = [];
    let droppedEvents = 0;
    const startedUrl = page.url();
    const record = (event: Record<string, unknown>) => {
      if (events.length < 10000) events.push({ ...event, time: Date.now(), pageUrl: page.url() });
      else droppedEvents++;
    };
    const consoleMessage = (message: ConsoleMessage) => record({ type: "console", level: message.type(), text: message.text(), location: message.location() });
    const pageError = (error: Error) => record({ type: "pageerror", error: { name: error.name, message: error.message, stack: error.stack } });
    page.on("console", consoleMessage);
    page.on("pageerror", pageError);
    try { await runFixture(); }
    finally {
      page.off("console", consoleMessage);
      page.off("pageerror", pageError);
      const reportPath = testInfo.outputPath("console-events.json");
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify({ schema: "super-canvas/performance-console-v1",
        testFile: "canvas-performance.spec.ts", testId: testInfo.testId, title: testInfo.title, retry: testInfo.retry,
        scope: "primary-page-through-fixture-teardown", capture: { startedUrl, startedBeforeNavigation: startedUrl === "about:blank", completed: true, droppedEvents }, events }));
      await testInfo.attach("canvas-performance-console", { path: reportPath, contentType: "application/json" });
    }
  }, { auto: true }],
});

// Conservative regression ceilings, not a claim of 60fps on every machine.
// Override per fixture: CANVAS_PERF_P95_PROMPT_500_MS=80, or use
// CANVAS_PERF_PROFILE_ONLY=1 to collect a new machine's baseline without a gate.
function p95Budget(scene: Scene, count: number) {
  const key = `CANVAS_PERF_P95_${scene.toUpperCase()}_${count}_MS`;
  const fallback = ({ 50: 33.4, 200: 66.7, 500: 120 } as Record<number, number>)[count]! * (scene === "mixed" ? 1.25 : 1);
  const limit = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error(`${key} must be a positive number`);
  return limit;
}

async function uploadPerformanceImages(request: APIRequestContext) {
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) {
    // Synthetic multi-megapixel test media exercises real decode/thumbnail work.
    const buffer = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: { r: 35 + i * 20, g: 70, b: 170 - i * 10 } } }).png().toBuffer();
    const response = await request.post("/api/assets/upload", { multipart: { file: { name: `perf-fixture-${i}.png`, mimeType: "image/png", buffer } } });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).id);
  }
  return ids;
}

// DOM snapshots on every pointer/wheel action materially distort large-graph timings.
test.use({ trace: process.env.CANVAS_PERF_TRACE === "1" ? "retain-on-failure" : "off", screenshot: "only-on-failure", video: "off" });

// Give each graph size its own Playwright context so previous large documents
// cannot remain in Chromium's navigation cache during the next measurement.
for (const { scene, count } of (["prompt", "mixed"] as const).flatMap((scene) => [50, 200, 500].map((count) => ({ scene, count })))) {
test(`画布 50/200/500 提示词与混合图片节点性能门槛 ${scene}/${count}`, async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(480_000);
  const rows: Measurement[] = [];
  let imageIds: string[] = [];
  const minimumAvailableMemoryBytes = 6 * 1024 ** 3;
  let availableBeforeBytes = 0;
  const start = () => {
    availableBeforeBytes = freemem();
    return page.evaluate(() => {
      const w = window as MeasuredWindow;
      w.__frames = [];
      w.__measure = true;
      let last = performance.now();
      const frame = (now: number) => {
        if (!w.__measure) return;
        w.__frames.push(now - last);
        last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  };
  const stop = async () => {
    const metrics = await page.evaluate(() => {
      const w = window as MeasuredWindow;
      w.__measure = false;
      const frames: number[] = w.__frames
        .slice(1)
        .sort((a: number, b: number) => a - b);
      return {
        samples: frames.length,
        p50: frames[Math.floor(frames.length * 0.5)] ?? 0,
        p95: frames[Math.floor(frames.length * 0.95)] ?? 0,
        max: frames.at(-1) ?? 0,
        over50ms: frames.filter((x) => x > 50).length,
      };
    });
    const availableAfterBytes = freemem();
    return { ...metrics, system: { availableBeforeBytes, availableAfterBytes, minimumAvailableMemoryBytes,
      valid: availableBeforeBytes >= minimumAvailableMemoryBytes && availableAfterBytes >= minimumAvailableMemoryBytes } };
  };
    console.log(`Preparing canvas performance scene: ${scene}/${count}`);
    if (scene === "mixed" && imageIds.length === 0) imageIds = await uploadPerformanceImages(request);
    await page.goto("about:blank");
    const graph: CanvasDocument = {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `perf-${i}`,
        type: "workflow",
        position: { x: (i % 25) * 350, y: Math.floor(i / 25) * 230 },
        // Saved image results already carry their measured geometry. Omitting it
        // makes every image load serialize and save the whole graph again.
        ...(scene === "mixed" && i % 3 !== 0 ? { style: { width: 300, height: 225 } } : {}),
        data: scene === "mixed" && i % 3 !== 0 ? {
          nodeType: "asset-input",
          label: `图片结果 ${i + 1}`,
          assetId: imageIds[i % imageIds.length],
          assetKind: "image",
          mediaAspectRatio: 4 / 3,
          generatedResult: true,
          generatedStatus: "succeeded",
          inputs: [],
          outputs: [{ id: "image", kind: "image", label: "图片" }],
        } : {
          nodeType: "prompt",
          label: `提示词 ${i + 1}`,
          parts: [{ type: "text", text: "画布性能检测" }],
          outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          inputs: [{ id: "in", kind: "text", label: "输入" }],
        },
      })),
      edges: Array.from({ length: scene === "mixed" ? Math.floor((count - 1) / 3) : count - 1 }, (_, i) => ({
        id: `perf-edge-${i}`,
        source: `perf-${scene === "mixed" ? i * 3 : i}`,
        sourceHandle: "prompt",
        target: `perf-${scene === "mixed" ? (i + 1) * 3 : i + 1}`,
        targetHandle: "in",
      })),
    };
    const created = await request.post("/api/canvas", {
      data: { title: `性能 ${scene} ${count}`, graph },
    });
    expect(created.ok()).toBeTruthy();
    const initial = await created.json();
    await page.goto(`/canvas/${initial.id}`);
    await page.locator('.react-flow__node[data-id="perf-0"]').waitFor();
    const inspector = page
      .getByRole("button", { name: /智能体面板/ })
      .first();
    if ((await inspector.getAttribute("aria-expanded")) === "true")
      await inspector.click();
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await page.waitForTimeout(450);
    if (scene === "mixed") {
      await expect.poll(() => page.locator(".generated-result-node img").count()).toBeGreaterThan(0);
      await expect.poll(() => page.locator(".generated-result-node img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    }
    const header = page.locator(
      '.react-flow__node[data-id="perf-0"] .node-head',
    );
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    const node = page.locator('.react-flow__node[data-id="perf-0"]');
    const beforeDrag = await node.evaluate(
      (el) => (el as HTMLElement).style.transform,
    );
    await start();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2 + 80,
      box!.y + box!.height / 2 + 40,
      { steps: 90 },
    );
    await page.mouse.up();
    expect(
      await node.evaluate((el) => (el as HTMLElement).style.transform),
    ).not.toBe(beforeDrag);
    const metrics = await stop();
    rows.push({ scene, count, gesture: "drag", ...metrics });
    // Wheel input and group dragging use the same graph and include visible selection effects.
    // The full-bleed canvas also sits behind floating islands. Find exposed
    // pane space without changing the selection established by the drag.
    const blankPosition = () => page.locator(".react-flow__pane").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const left = Math.max(bounds.left + 16, 16);
      const right = Math.min(bounds.right - 16, innerWidth - 16);
      const top = Math.max(bounds.top + 16, 16);
      const bottom = Math.min(bounds.bottom - 16, innerHeight - 16);
      for (let y = top; y <= bottom; y += 32) {
        for (const fraction of [.5, .25, .75, .125, .875]) {
          const x = left + (right - left) * fraction;
          if (document.elementFromPoint(x, y) === element) return { x, y };
        }
      }
      return null;
    });
    await expect.poll(blankPosition, { message: "The wheel gesture must start over exposed canvas, outside floating islands and node editors" }).not.toBeNull();
    const wheelPoint = await blankPosition();
    expect(wheelPoint).not.toBeNull();
    await page.mouse.move(wheelPoint!.x, wheelPoint!.y);
    const beforeZoom = await page
      .locator(".react-flow__viewport")
      .getAttribute("style");
    let duringZoom = beforeZoom;
    const profiler = process.env.CANVAS_CPU_PROFILE && count === 500
      ? await page.context().newCDPSession(page) : null;
    if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
    const timeline = process.env.CANVAS_PERF_NATIVE_TRACE === "1" ? profiler : null;
    const traceComplete = timeline ? new Promise<{ stream?: string }>(resolve => timeline.once("Tracing.tracingComplete", resolve)) : null;
    if (timeline) {
      await timeline.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8", transferMode: "ReturnAsStream" });
      await page.evaluate(() => {
        const wrap = document.querySelector(".canvas-wrap")!, viewport = document.querySelector(".react-flow__viewport")!;
        const audit: ZoomAudit = { wheels: [], classes: [] };
        const wheel = (event: WheelEvent) => audit.wheels.push({ time: performance.now(), eventTime: event.timeStamp,
          deltaY: event.deltaY, interacting: wrap.classList.contains("is-interacting") });
        const record = (records: MutationRecord[]) => {
          for (const entry of records) audit.classes.push({ time: performance.now(), host: entry.target === wrap ? "wrap" : "viewport",
            before: entry.oldValue, after: (entry.target as Element).getAttribute("class") });
        };
        const observer = new MutationObserver(record);
        observer.observe(wrap, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
        observer.observe(viewport, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
        document.addEventListener("wheel", wheel, { capture: true, passive: true });
        performance.mark("canvas-perf-zoom-start");
        (window as MeasuredWindow).__stopZoomAudit = () => {
          performance.mark("canvas-perf-zoom-end");
          record(observer.takeRecords()); observer.disconnect();
          document.removeEventListener("wheel", wheel, true);
          delete (window as MeasuredWindow).__stopZoomAudit;
          return audit;
        };
      });
    }
    if (process.env.CANVAS_PERF_NODE_CHURN === "1") await page.evaluate(() => {
      const root = document.querySelector(".react-flow__nodes")!;
      const count = () => [...root.children].filter(node => node.classList.contains("react-flow__node")).length;
      let current = count();
      const churn: NodeChurn = { initial: current, minimum: current, peak: current, final: current, added: 0, removed: 0 };
      const apply = (records: MutationRecord[]) => {
        for (const record of records) {
          const nodes = (list: NodeList) => [...list].filter(node => node instanceof Element && node.classList.contains("react-flow__node")).length;
          const added = nodes(record.addedNodes), removed = nodes(record.removedNodes);
          churn.added += added;
          churn.removed += removed;
          current += added - removed;
          churn.minimum = Math.min(churn.minimum, current);
          churn.peak = Math.max(churn.peak, current);
        }
      };
      const observer = new MutationObserver(apply);
      observer.observe(root, { childList: true });
      (window as MeasuredWindow).__stopNodeChurn = () => {
        apply(observer.takeRecords());
        observer.disconnect();
        churn.final = count();
        delete (window as MeasuredWindow).__stopNodeChurn;
        return churn;
      };
    });
    await start();
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, i < 6 ? -60 : 60);
      await page.waitForTimeout(30);
      if (i === 5)
        duringZoom = await page
          .locator(".react-flow__viewport")
          .getAttribute("style");
    }
    await page.waitForTimeout(180);
    const zoomMetrics = await stop();
    const nodeChurn = process.env.CANVAS_PERF_NODE_CHURN === "1"
      ? await page.evaluate(() => (window as MeasuredWindow).__stopNodeChurn?.()) : undefined;
    const zoomAudit = timeline ? await page.evaluate(() => (window as MeasuredWindow).__stopZoomAudit?.()) : undefined;
    rows.push({ scene, count, gesture: "zoom", ...zoomMetrics, ...(nodeChurn ? { nodeChurn } : {}), ...(zoomAudit ? { zoomAudit } : {}) });
    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");
      const profilePath = testInfo.outputPath(`${scene}-zoom.cpuprofile`);
      await mkdir(dirname(profilePath), { recursive: true });
      await writeFile(profilePath, JSON.stringify(profile));
      if (!timeline) await profiler.detach();
    }
    if (timeline && traceComplete) {
      await timeline.send("Tracing.end");
      const { stream } = await traceComplete;
      if (!stream) throw new Error("Native timeline did not return a stream");
      let trace = "";
      for (;;) {
        const part = await timeline.send("IO.read", { handle: stream });
        trace += part.base64Encoded ? Buffer.from(part.data, "base64").toString("utf8") : part.data;
        if (part.eof) break;
      }
      await timeline.send("IO.close", { handle: stream });
      await writeFile(testInfo.outputPath(`${scene}-zoom.trace.json`), trace);
      await timeline.detach();
    }
    // Zoom is tested in both directions; fit again to expose all group members.
    expect(duringZoom).not.toBe(beforeZoom);
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await page.waitForTimeout(450);
    await clickBlankCanvas(page);
    await page.keyboard.press("Control+a");
    await expect
      .poll(() => page.locator(".react-flow__node.selected").count())
      .toBe(count);
    if (scene === "mixed") {
      await page.waitForTimeout(250);
      await expect(page.getByRole("toolbar", { name: "生成结果操作" })).toHaveCount(0);
      const sizes = await page.locator(".generated-result-node img").evaluateAll((images) => images.map((image) => Number(new URL((image as HTMLImageElement).src).searchParams.get("size"))));
      expect(sizes.length).toBeGreaterThan(0);
      expect(sizes.every((size) => size > 0 && size < 3840), "Selecting a whole overview must not upgrade every result to 3840px").toBe(true);
    }
    // The first node was moved into the grid by the single-node measurement.
    // Use an unobstructed header instead of accidentally clicking an editor on
    // an overlapping node and collapsing the selection during the benchmark.
    const groupAnchor = page.locator('.react-flow__node[data-id="perf-24"]');
    const selected = groupAnchor.locator(".node-head");
    const groupBefore = await groupAnchor.getAttribute("style");
    const groupBox = await selected.boundingBox();
    expect(groupBox).not.toBeNull();
    await page.mouse.move(
      groupBox!.x + groupBox!.width / 2,
      groupBox!.y + groupBox!.height / 2,
    );
    await page.mouse.down();
    await start();
    await page.mouse.move(
      groupBox!.x + groupBox!.width / 2 + 65,
      groupBox!.y + groupBox!.height / 2 + 25,
      { steps: 60 },
    );
    await page.mouse.up();
    rows.push({ scene, count, gesture: "multiselect-drag", ...(await stop()) });
    expect(await groupAnchor.getAttribute("style")).not.toBe(groupBefore);
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(count);
  const reportPath = testInfo.outputPath("performance.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(rows, null, 2));
  await testInfo.attach("canvas-performance", { path: reportPath, contentType: "application/json" });
  console.log(JSON.stringify(rows));
  for (const row of rows) {
    expect.soft(row.system.valid, `${row.scene}/${row.count}/${row.gesture}: available RAM must be >= 6 GiB`).toBe(true);
    expect.soft(row.samples, `${row.scene}/${row.count}/${row.gesture}: insufficient frame samples`).toBeGreaterThan(10);
    if (process.env.CANVAS_PERF_PROFILE_ONLY !== "1") {
      expect.soft(row.p95, `${row.scene}/${row.count}/${row.gesture}: P95 regression`).toBeLessThanOrEqual(p95Budget(row.scene, row.count));
    }
  }
});
}
