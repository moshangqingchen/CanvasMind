import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasDocument } from "../components/types";
import { installNeuralFixture } from "./helpers/neural-fixture";

const repository = fileURLToPath(new URL("../../../..", import.meta.url));
const output = resolve(repository, process.env.NEURAL_EVIDENCE_DIR ?? ".codex-logs/2026-10-16-redesign-v2/out");
const ambient = (page: Page) => page.getByTestId("canvas-ambient-effects");
const motion = (page: Page) => page.getByRole("button", { name: "画布动效", exact: true });
// Action snapshots materially distort short frame-time measurements.
test.use({ trace: "off", video: "off" });

function graph(count = 2, dense = false): CanvasDocument {
  return { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], drawings: [], nodes: Array.from({ length: count }, (_, index) => ({
    id: `ambient-${index}`, type: "workflow",
    position: { x: 150 + (index % (dense ? 20 : 25)) * (dense ? 44 : 350), y: 130 + Math.floor(index / (dense ? 20 : 25)) * (dense ? 42 : 230) },
    ...(dense ? { style: { width: 38, height: 32 } } : {}),
    data: { nodeType: "prompt", label: `离线光效节点 ${index + 1}`, parts: [{ type: "text", text: "仅界面与帧时验收，不提交任务" }],
      inputs: [{ id: "in", kind: "text", label: "输入" }], outputs: [{ id: "out", kind: "text", label: "输出" }] },
  })) };
}

async function open(page: Page, options: { count?: number; dense?: boolean; theme?: "dark" | "light"; running?: boolean } = {}) {
  const fixture = await installNeuralFixture(page, { theme: options.theme });
  let canvas = graph(options.count, options.dense), revision = 1;
  // Ordinary task state comes from read-only run snapshots, not saved `status`.
  // A pending generated-result snapshot is an existing persisted render path.
  if (options.running) Object.assign(canvas.nodes[0]!.data, { nodeType: "asset-input", assetKind: "image", generatedResult: true, generatedStatus: "running" });
  await page.route("**/api/canvas/neural-autumn", route => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { graph?: CanvasDocument };
      if (body.graph) canvas = body.graph;
      revision++;
    }
    return route.fulfill({ json: { id: "neural-autumn", title: "离线画布光效验收", graph: canvas, revision } });
  });
  await page.goto("/canvas/neural-autumn");
  await expect(page.locator('.react-flow__node[data-id="ambient-0"]')).toBeVisible();
  await expect(ambient(page)).toBeAttached();
  return fixture;
}

async function blankPoint(page: Page) {
  const point = await page.locator(".react-flow__pane").evaluate(pane => {
    const bounds = pane.getBoundingClientRect();
    for (let y = Math.max(90, bounds.y + 25); y < Math.min(innerHeight - 100, bounds.bottom - 20); y += 35) {
      for (let x = Math.max(85, bounds.x + 25); x < Math.min(innerWidth - 85, bounds.right - 20); x += 35) {
        if (document.elementFromPoint(x, y) === pane && document.elementFromPoint(x + 26, y + 12) === pane) return { x, y };
      }
    }
    return null;
  });
  expect(point, "必须在空白画布上开始手势").not.toBeNull();
  return point!;
}

for (const theme of ["dark", "light"] as const) test(`空白拖尾、网格聚光和运行细光跟随 ${theme} 动效并清理`, async ({ page }) => {
  const fixture = await open(page, { theme, running: true });
  await expect(ambient(page)).toHaveAttribute("data-detail", "full");
  await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
  const point = await blankPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.move(point.x + 22, point.y + 12, { steps: 4 });
  await expect(ambient(page)).toHaveAttribute("data-pointer", "true");
  const spotlight = ambient(page).locator("div").first();
  await expect(spotlight).toHaveCSS("opacity", "0.65");
  const running = page.locator(".node-running-light").first();
  await expect(running).toBeVisible();
  await mkdir(resolve(output, "canvas"), { recursive: true });
  await page.screenshot({ path: resolve(output, "canvas", `${theme}-grid-running-trail.png`), animations: "allow" });
  await page.mouse.down();
  await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
  await expect(ambient(page)).toHaveAttribute("data-pointer", "false");
  await page.mouse.up();
  await motion(page).click();
  await expect(ambient(page)).toHaveAttribute("data-detail", "off");
  await expect(running).toBeHidden();
  await expect(spotlight).toHaveCSS("opacity", "0");
  await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
  await motion(page).click();
  await expect(ambient(page)).toHaveAttribute("data-detail", "full");
  await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
  fixture.assertSafe();
});

test("低缩放、200 个可见节点与系统减少动态效果自动停用装饰", async ({ page }) => {
  const fixture = await open(page, { count: 200, dense: true });
  await expect.poll(async () => Number(await ambient(page).getAttribute("data-visible-nodes"))).toBeGreaterThan(150);
  await expect(ambient(page)).toHaveAttribute("data-detail", "off");
  await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(motion(page)).toHaveAttribute("aria-pressed", "false");
  await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
  fixture.assertSafe();
});

test("新建连线只跑一次细脉冲，手动关闭动效后不残留", async ({ page }) => {
  const fixture = await open(page);
  const source = page.locator('.react-flow__node[data-id="ambient-0"] .react-flow__handle.source');
  const target = page.locator('.react-flow__node[data-id="ambient-1"] .react-flow__handle.target');
  const from = await source.boundingBox(), to = await target.boundingBox();
  expect(from).not.toBeNull(); expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator(".canvas-new-edge-pulse")).toHaveCount(1);
  await mkdir(resolve(output, "canvas"), { recursive: true });
  await page.screenshot({ path: resolve(output, "canvas", "new-edge-pulse.png"), animations: "allow" });
  await expect(page.locator(".canvas-new-edge-pulse")).toHaveCount(0);
  await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
  fixture.assertSafe();
});

test("200 节点画布动效开关的拖拽与缩放帧时 A/B", async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await open(page, { count: 200 });
  await expect(page.locator(".react-flow__node")).toHaveCount(200);
  const measurements: Array<{ enabled: boolean; gesture: string; frames: number; p50: number; p95: number; max: number }> = [];
  for (const enabled of [false, true, true, false]) {
    if ((await motion(page).getAttribute("aria-pressed")) !== String(enabled)) await motion(page).click();
    await page.waitForTimeout(350);
    for (const gesture of ["drag", "zoom"] as const) {
      await page.evaluate(() => {
        const w = window as typeof window & { __ambientFrames?: number[]; __ambientMeasuring?: boolean };
        w.__ambientFrames = []; w.__ambientMeasuring = true;
        let previous = performance.now();
        const tick = (time: number) => { if (!w.__ambientMeasuring) return; w.__ambientFrames!.push(time - previous); previous = time; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      if (gesture === "drag") {
        const box = await page.locator('.react-flow__node[data-id="ambient-0"] .node-head').boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(box!.x + 70, box!.y + 14); await page.mouse.down();
        await page.mouse.move(box!.x + 125, box!.y + 40, { steps: 80 });
        await page.mouse.move(box!.x + 70, box!.y + 14, { steps: 80 });
        await page.mouse.up();
      } else {
        const point = await blankPoint(page); await page.mouse.move(point.x, point.y);
        for (let index = 0; index < 24; index++) { await page.mouse.wheel(0, index < 12 ? 5 : -5); await page.waitForTimeout(35); }
      }
      const metrics = await page.evaluate(() => {
        const w = window as typeof window & { __ambientFrames?: number[]; __ambientMeasuring?: boolean };
        w.__ambientMeasuring = false;
        const frames = w.__ambientFrames!.slice(2).sort((a, b) => a - b);
        delete w.__ambientFrames;
        return { frames: frames.length, p50: frames[Math.floor(frames.length * .5)] ?? 0, p95: frames[Math.floor(frames.length * .95)] ?? 0, max: frames.at(-1) ?? 0 };
      });
      expect(metrics.frames).toBeGreaterThan(15);
      measurements.push({ enabled, gesture, ...metrics });
    }
  }
  const comparisons = ["drag", "zoom"].map(gesture => {
    const averageP95 = (enabled: boolean) => { const rows = measurements.filter(row => row.gesture === gesture && row.enabled === enabled); return rows.reduce((sum, row) => sum + row.p95, 0) / rows.length; };
    const offP95 = averageP95(false), onP95 = averageP95(true);
    return { gesture, offP95, onP95, addedP95: onP95 - offP95, targetMs: 1, withinTarget: onP95 - offP95 <= 1 };
  });
  await mkdir(resolve(output, "canvas"), { recursive: true });
  const path = resolve(output, "canvas", "performance-200-nodes.json");
  await writeFile(path, JSON.stringify({ at: new Date().toISOString(), fixture: "200 prompt nodes in a 25-column graph; real DOM drag and wheel; ABBA motion preference; new effects stop during gestures", measurements, comparisons }, null, 2));
  await info.attach("canvas-effects-performance", { path, contentType: "application/json" });
  fixture.assertSafe();
  for (const result of comparisons) expect(result.addedP95, `${result.gesture} P95 增量目标`).toBeLessThanOrEqual(1);
});

test("开启光效并实际触发拖尾后首页与画布往返 20 次不累积资源", async ({ page, context }, info) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const WeakReference = (globalThis as unknown as { WeakRef: new (context: object) => { deref(): object | undefined } }).WeakRef;
    const references: Array<{ kind: string; ref: { deref(): object | undefined } }> = [];
    const seen = new WeakSet<object>();
    Object.assign(window, { __ambientContextProbe: references });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      const result = Reflect.apply(original, this, args);
      if (result && !seen.has(result) && (String(args[0]).startsWith("webgl") || this.closest('[data-testid="canvas-ambient-effects"]'))) {
        seen.add(result); references.push({ kind: String(args[0]), ref: new WeakReference(result) });
      }
      return result;
    } as typeof original;
  });
  const fixture = await open(page);
  const cdp = await context.newCDPSession(page); await cdp.send("Performance.enable");
  const samples: Array<{ cycle: number; heapBytes: number; nodes: number; listeners: number; documents: number; webgl: number; ambient2d: number }> = [];
  const home = async () => {
    const point = await blankPoint(page); await page.mouse.move(point.x, point.y); await page.mouse.move(point.x + 15, point.y + 10);
    await expect(ambient(page)).toHaveAttribute("data-pointer", "true");
    await expect(ambient(page)).toHaveAttribute("data-frame-active", "false");
    await page.getByRole("button", { name: "返回主界面", exact: true }).click();
    await expect(page.getByTestId("neural-workspace")).toBeVisible();
  };
  const enter = async () => {
    await page.getByTestId("neural-module-canvases").click();
    await page.getByTestId("neural-item-neural-autumn").click();
    await page.getByTestId("neural-inspector").getByRole("button", { name: "打开画布", exact: true }).click();
    await expect(ambient(page)).toHaveAttribute("data-detail", "full");
  };
  const sample = async (cycle: number) => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics"), counters = await cdp.send("Memory.getDOMCounters");
    const contexts = await page.evaluate(() => {
      const refs = (window as typeof window & { __ambientContextProbe?: Array<{ kind: string; ref: { deref(): object | undefined } }> }).__ambientContextProbe ?? [];
      const active = refs.filter(entry => {
        const value = entry.ref.deref();
        return value && (!entry.kind.startsWith("webgl") || !(value as WebGLRenderingContext).isContextLost());
      });
      refs.splice(0, refs.length, ...active);
      return { webgl: active.filter(entry => entry.kind.startsWith("webgl")).length, ambient2d: active.filter(entry => entry.kind === "2d").length };
    });
    samples.push({ cycle, heapBytes: metrics.find(metric => metric.name === "JSHeapUsedSize")?.value ?? 0, nodes: counters.nodes, listeners: counters.jsEventListeners, documents: counters.documents, ...contexts });
  };
  await home(); await enter(); await home(); await sample(0);
  for (let cycle = 1; cycle <= 20; cycle++) { await enter(); await home(); await sample(cycle); }
  await mkdir(resolve(output, "canvas"), { recursive: true });
  const path = resolve(output, "canvas", "memory-motion-on-20-roundtrips.json");
  await writeFile(path, JSON.stringify({ at: new Date().toISOString(), fixture: "motion on; real blank-pane pointer events every canvas visit; all samples on home after explicit GC; WeakRef probes pruned per sample", samples }, null, 2));
  await info.attach("motion-on-memory", { path, contentType: "application/json" });
  const baseline = samples[0]!, tail = samples.slice(-6);
  expect(tail.every(row => row.webgl <= 1)).toBe(true);
  expect(tail.every(row => row.ambient2d === 0), "卸载后装饰 Canvas2D 不应被监听器或 rAF 保留").toBe(true);
  expect(Math.max(...tail.map(row => row.heapBytes)) - baseline.heapBytes).toBeLessThan(12 * 1024 ** 2);
  expect(tail.at(-1)!.nodes - baseline.nodes).toBeLessThan(300);
  expect(tail.at(-1)!.listeners - baseline.listeners).toBeLessThan(100);
  expect(tail.every((row, index) => !index || row.heapBytes > tail[index - 1]!.heapBytes), "最后六轮 GC 后堆不应严格单调增长").toBe(false);
  fixture.assertSafe();
});
