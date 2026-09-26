import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

type Position = { x: number; y: number };
type CheckpointWindow = typeof window & { __draftPositions: Position[] };

async function createCanvas(request: APIRequestContext) {
  const response = await request.post("/api/canvas", { data: { title: "拖动草稿检查点", graph: {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    edges: [],
    nodes: [{ id: "checkpoint", type: "workflow", position: { x: 100, y: 100 }, data: { nodeType: "prompt", label: "拖动保存", parts: [{ type: "text", text: "检查点" }], inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } }],
  } } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

async function position(page: Page): Promise<Position> {
  return page.locator('.react-flow__node[data-id="checkpoint"]').evaluate((element) => {
    const matrix = new DOMMatrixReadOnly((element as HTMLElement).style.transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
}

async function serverPosition(request: APIRequestContext, id: string): Promise<Position> {
  const canvas = await (await request.get(`/api/canvas/${id}`)).json();
  return canvas.graph.nodes.find((node: { id: string }) => node.id === "checkpoint").position;
}

test("连续拖动定期合并草稿，松手、CtrlS与离页保存最新位置", async ({ page, request }) => {
  await page.addInitScript(() => {
    const w = window as CheckpointWindow;
    w.__draftPositions = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "drafts") {
        const node = value?.graph?.nodes?.find((item: { id: string }) => item.id === "checkpoint");
        if (node) w.__draftPositions.push({ ...node.position });
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  const id = await createCanvas(request);
  await page.goto(`/canvas/${id}`);
  const header = page.locator('.react-flow__node[data-id="checkpoint"] .node-head');
  await header.waitFor();
  await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  await page.evaluate(() => { (window as CheckpointWindow).__draftPositions = []; });
  const start = await page.evaluate(() => performance.now());
  await page.mouse.move(box!.x + 30, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + 190, box!.y + 90, { steps: 90 });
  await page.waitForTimeout(450);
  const elapsed = await page.evaluate((start) => performance.now() - start, start);
  const writes = await page.evaluate(() => (window as CheckpointWindow).__draftPositions);
  expect(writes.length, "a continuous gesture must retain a recoverable checkpoint").toBeGreaterThan(0);
  expect(writes.length, "pointer frames must not each clone and write the graph").toBeLessThanOrEqual(Math.ceil(elapsed / 400) + 2);
  expect(writes.at(-1)).toEqual(await position(page));

  await page.mouse.move(box!.x + 230, box!.y + 95);
  const released = await position(page);
  await page.mouse.up();
  await expect.poll(() => serverPosition(request, id)).toEqual(released);

  const movedBox = await header.boundingBox();
  await page.mouse.move(movedBox!.x + 30, movedBox!.y + 15);
  await page.mouse.down();
  await page.mouse.move(movedBox!.x + 65, movedBox!.y + 25);
  const manuallySaved = await position(page);
  await page.keyboard.press("Control+s");
  await expect.poll(() => serverPosition(request, id)).toEqual(manuallySaved);

  await page.mouse.move(movedBox!.x + 90, movedBox!.y + 30);
  const hidden = await position(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(() => serverPosition(request, id)).toEqual(hidden);
  await page.mouse.up();
});

test("未松手时离开失败保存的画布，重新进入仍恢复最后拖动位置", async ({ page, request }) => {
  const id = await createCanvas(request);
  await page.goto("/");
  await page.locator(`a[href="/canvas/${id}"]`).last().click();
  const header = page.locator('.react-flow__node[data-id="checkpoint"] .node-head');
  await header.waitFor();
  await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
  await page.route(`**/api/canvas/${id}`, async (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 503, json: { error: "测试离线保存" } });
    await route.continue();
  });
  const box = await header.boundingBox();
  await page.mouse.move(box!.x + 30, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + 120, box!.y + 55);
  const last = await position(page);
  // Client navigation runs the component cleanup before the 400ms checkpoint.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await page.mouse.up();
  await page.unroute(`**/api/canvas/${id}`);
  await page.locator(`a[href="/canvas/${id}"]`).last().click();
  await header.waitFor();
  await expect.poll(() => position(page)).toEqual(last);
  await expect.poll(() => serverPosition(request, id)).toEqual(last);
});
