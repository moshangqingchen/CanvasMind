import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { CanvasNode, RunSnapshot } from "../components/types";

type ObservedWindow = Window & { auditStreams: { url: string; closed: boolean; emit?: () => void }[] };

async function fixture(page: Page, request: APIRequestContext, initiallyFail = false, initiallyOmit = false) {
  const upload = await request.post("/api/assets/upload", { multipart: { file: {
    name: "任务状态测试.png", mimeType: "image/png",
    buffer: await readFile(new URL("../../assets/icon.png", import.meta.url)),
  } } });
  expect(upload.ok()).toBeTruthy();
  const asset = await upload.json() as { id: string };
  const runIds = Array.from({ length: 51 }, (_, i) => `audit-run-${i}`);
  const source: CanvasNode = {
    id: "source", type: "workflow", position: { x: 50, y: 50 },
    data: { nodeType: "image-generation", label: "状态测试源", provider: "fake", model: "fake-image-v1",
      connectionId: "fake-default", parts: [], parameters: { n: 1 }, inputs: [],
      outputs: [{ id: "images", label: "图片", kind: "image" }] },
  };
  const results: CanvasNode[] = runIds.map((runId, i) => ({
    id: `result-${i}`, type: "workflow", position: { x: 520, y: i === 50 ? 50 : 1200 + i * 250 },
    data: { nodeType: "asset-input", label: `结果 ${i}`, assetKind: "image",
      generatedResult: true, generatedFromNodeId: "source", generatedFromRunId: runId,
      generatedOutputIndex: 0, generatedStatus: i === 50 ? "running" : "succeeded",
      ...(i === 50 ? {} : { assetId: asset.id }),
      outputs: [{ id: "asset", label: "图片", kind: "image" }] },
  }));
  const created = await request.post("/api/canvas", { data: { title: "多任务同步回归", graph: {
    schemaVersion: 1, nodes: [source, ...results], edges: [], viewport: { x: 0, y: 0, zoom: 0.8 },
  } } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json() as { id: string };
  const state = { fail: initiallyFail, omit: initiallyOmit, completed: false, submissions: 0, batches: [] as string[][],
    delayNextActiveRead: false, delayedRead: false };
  let releaseDelayedRead = () => {};
  const snapshot = (runId: string): RunSnapshot => {
    const index = runIds.indexOf(runId);
    const status = index === 50 && !state.completed ? "running" : "succeeded";
    const createdAt = new Date(Date.UTC(2026, 8, 26, 8, 0, index)).toISOString();
    const updatedAt = new Date(Date.parse(createdAt) + (index === 50 && state.completed ? 60_000 : 0)).toISOString();
    return { run: { id: runId, canvasId: canvas.id, clientRequestId: `request-${index}`, scope: "node",
      nodeId: "source", status, createdAt, updatedAt },
      nodes: [{ id: `node-run-${index}`, nodeId: "source", status, updatedAt,
        outputAssetIds: status === "succeeded" ? [asset.id] : [], errorJson: null }] };
  };
  await page.addInitScript(() => {
    const observed = window as unknown as ObservedWindow;
    observed.auditStreams = [];
    class TestEventSource {
      onmessage: (() => void) | null = null;
      onerror = null;
      record: { url: string; closed: boolean; emit: () => void };
      constructor(url: string) {
        this.record = { url, closed: false, emit: () => { this.onmessage?.(); } };
        observed.auditStreams.push(this.record);
      }
      close() { this.record.closed = true; }
    }
    window.EventSource = TestEventSource as unknown as typeof EventSource;
  });
  await page.route(/\/api\/runs(?:\?|\/|$)/u, async (route) => {
    const req = route.request();
    if (req.method() !== "GET") { state.submissions++; return route.abort(); }
    const url = new URL(req.url());
    if (url.pathname === "/api/runs") {
      const requested = (url.searchParams.get("runIds") ?? "").split(",").filter(Boolean);
      state.batches.push(requested);
      if (state.fail && requested.includes(runIds[50]!))
        return route.fulfill({ status: 503, json: { error: "测试临时不可用" } });
      if (state.delayNextActiveRead && requested.includes(runIds[50]!)) {
        state.delayNextActiveRead = false;
        const delayed = requested.slice(0, 50).map(snapshot);
        state.delayedRead = true;
        await new Promise<void>(resolve => { releaseDelayedRead = resolve; });
        return route.fulfill({ json: delayed });
      }
      return route.fulfill({ json: requested.slice(0, 50)
        .filter((runId) => !state.omit || runId !== runIds[50]).map(snapshot) });
    }
    return route.fulfill({ json: snapshot(url.pathname.split("/").pop()!) });
  });
  await page.goto(`/canvas/${canvas.id}`);
  const liveStreams = () => page.evaluate(() => (window as unknown as ObservedWindow).auditStreams
    .filter((stream) => stream.url.includes("audit-run-50/") && !stream.closed).length);
  const reconcile = () => page.evaluate(() => window.dispatchEvent(new Event("canvas-reconcile-tasks")));
  return { state, canvas, asset, liveStreams, reconcile, releaseDelayedRead: () => releaseDelayedRead() };
}

test("第51个任务持续订阅，缺失响应和部分失败不关闭任务，重试后正常完成", async ({ page, request }) => {
  const ui = await fixture(page, request);
  await expect.poll(ui.liveStreams).toBe(1);
  expect(ui.state.batches.every((batch) => batch.length <= 50)).toBe(true);
  ui.state.omit = true;
  const previousBatches = ui.state.batches.length;
  await ui.reconcile();
  await expect.poll(() => ui.state.batches.length).toBeGreaterThan(previousBatches);
  await expect.poll(ui.liveStreams).toBe(1);
  ui.state.omit = false;
  ui.state.fail = true;
  await ui.reconcile();
  const retry = page.getByRole("button", { name: "重试任务状态同步", exact: true });
  await expect(retry).toBeVisible();
  expect(await ui.liveStreams()).toBe(1);
  ui.state.fail = false;
  ui.state.completed = true;
  await retry.click();
  await expect(retry).toBeHidden();
  await expect.poll(ui.liveStreams).toBe(0);
  await expect.poll(async () => {
    const saved = await (await request.get(`/api/canvas/${ui.canvas.id}`)).json();
    return saved.graph.nodes.find((node: CanvasNode) => node.id === "result-50")?.data;
  }).toMatchObject({ generatedStatus: "succeeded", assetId: ui.asset.id });
  expect(ui.state.submissions).toBe(0);
});

test("刷新时查询失败也会继续自动核对已有runId的任务", async ({ page, request }) => {
  const ui = await fixture(page, request, true);
  const retry = page.getByRole("button", { name: "重试任务状态同步", exact: true });
  await expect(retry).toBeVisible();
  expect(await ui.liveStreams()).toBe(0);
  ui.state.fail = false;
  await expect.poll(ui.liveStreams, { timeout: 12_000 }).toBe(1);
  await expect(retry).toBeHidden();
  expect(ui.state.submissions).toBe(0);
});

test("刷新时首次响应暂缺任务，后续轮询仍能找回并订阅", async ({ page, request }) => {
  const ui = await fixture(page, request, false, true);
  await expect.poll(() => ui.state.batches.some((batch) => batch.includes("audit-run-50"))).toBe(true);
  expect(await ui.liveStreams()).toBe(0);
  ui.state.omit = false;
  await expect.poll(ui.liveStreams, { timeout: 12_000 }).toBe(1);
  expect(ui.state.submissions).toBe(0);
});

test("旧轮询晚于完成事件返回时不会回退结果或重新建立订阅", async ({ page, request }) => {
  const ui = await fixture(page, request);
  await expect.poll(ui.liveStreams).toBe(1);
  ui.state.delayNextActiveRead = true;
  await ui.reconcile();
  await expect.poll(() => ui.state.delayedRead).toBe(true);
  ui.state.completed = true;
  await page.evaluate(() => {
    const stream = (window as unknown as ObservedWindow).auditStreams
      .find(item => item.url.includes("audit-run-50/") && !item.closed);
    stream?.emit?.();
  });
  await expect.poll(ui.liveStreams).toBe(0);
  const streamCount = () => page.evaluate(() => (window as unknown as ObservedWindow).auditStreams
    .filter(item => item.url.includes("audit-run-50/")).length);
  const streamsBeforeRelease = await streamCount();
  const batchesBeforeRelease = ui.state.batches.length;
  ui.releaseDelayedRead();
  await ui.reconcile();
  // The follow-up read starts only after the delayed reconciliation settles.
  await expect.poll(() => ui.state.batches.length).toBeGreaterThan(batchesBeforeRelease);
  await expect.poll(ui.liveStreams).toBe(0);
  expect(await streamCount()).toBe(streamsBeforeRelease);
  await expect.poll(async () => {
    const saved = await (await request.get(`/api/canvas/${ui.canvas.id}`)).json();
    return saved.graph.nodes.find((node: CanvasNode) => node.id === "result-50")?.data;
  }).toMatchObject({ generatedStatus: "succeeded", assetId: ui.asset.id });
  expect(ui.state.submissions).toBe(0);
});
