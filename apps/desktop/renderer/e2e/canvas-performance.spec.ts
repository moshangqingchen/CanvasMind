import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import type { CanvasDocument } from "../components/types";

type MeasuredWindow = typeof window & { __frames: number[]; __measure: boolean };
type Scene = "prompt" | "mixed";
type Measurement = { scene: Scene; count: number; gesture: string; samples: number; p50: number; p95: number; max: number; over50ms: number };

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
  const start = () =>
    page.evaluate(() => {
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
  const stop = () =>
    page.evaluate(() => {
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
    const pane = await page.locator(".react-flow__pane").boundingBox();
    expect(pane).not.toBeNull();
    await page.mouse.move(
      pane!.x + pane!.width * 0.5,
      // Fit View leaves space above the graph. The center can be a prompt's
      // scrollable editor, which intentionally consumes wheel input.
      pane!.y + 16,
    );
    const beforeZoom = await page
      .locator(".react-flow__viewport")
      .getAttribute("style");
    let duringZoom = beforeZoom;
    const profiler = process.env.CANVAS_CPU_PROFILE && count === 500
      ? await page.context().newCDPSession(page) : null;
    if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
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
    rows.push({ scene, count, gesture: "zoom", ...(await stop()) });
    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");
      const profilePath = testInfo.outputPath(`${scene}-zoom.cpuprofile`);
      await mkdir(dirname(profilePath), { recursive: true });
      await writeFile(profilePath, JSON.stringify(profile));
      await profiler.detach();
    }
    // Zoom is tested in both directions; fit again to expose all group members.
    expect(duringZoom).not.toBe(beforeZoom);
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await page.waitForTimeout(450);
    await page.mouse.click(
      pane!.x + pane!.width - 8,
      pane!.y + pane!.height - 55,
    );
    await page.keyboard.press("Control+a");
    await expect
      .poll(() => page.locator(".react-flow__node.selected").count())
      .toBeGreaterThan(1);
    if (scene === "mixed") {
      await page.waitForTimeout(250);
      await expect(page.getByRole("toolbar", { name: "生成结果操作" })).toHaveCount(0);
      const sizes = await page.locator(".generated-result-node img").evaluateAll((images) => images.map((image) => Number(new URL((image as HTMLImageElement).src).searchParams.get("size"))));
      expect(sizes.length).toBeGreaterThan(0);
      expect(sizes.every((size) => size > 0 && size < 3840), "Selecting a whole overview must not upgrade every result to 3840px").toBe(true);
    }
    const selected = page
      .locator(".react-flow__node.selected .node-head")
      .first();
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
  const reportPath = testInfo.outputPath("performance.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(rows, null, 2));
  await testInfo.attach("canvas-performance", { path: reportPath, contentType: "application/json" });
  console.log(JSON.stringify(rows));
  for (const row of rows) {
    expect.soft(row.samples, `${row.scene}/${row.count}/${row.gesture}: insufficient frame samples`).toBeGreaterThan(10);
    if (process.env.CANVAS_PERF_PROFILE_ONLY !== "1") {
      expect.soft(row.p95, `${row.scene}/${row.count}/${row.gesture}: P95 regression`).toBeLessThanOrEqual(p95Budget(row.scene, row.count));
    }
  }
});
}
