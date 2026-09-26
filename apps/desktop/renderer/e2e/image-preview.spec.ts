import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function fixture(request: APIRequestContext, generated: boolean) {
  const upload = await request.post("/api/assets/upload?name=double-click.png", {
    headers: { "content-type": "image/png" },
    data: png,
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json() as { id: string };
  const id = `image-preview-${randomUUID()}`;
  const created = await request.post("/api/canvas", {
    data: {
      id,
      title: id,
      graph: {
        schemaVersion: 1,
        viewport: { x: 20, y: 20, zoom: 1 },
        nodes: [{
          id: "picture", type: "workflow", position: { x: 60, y: 90 },
          style: { width: 300, height: 300 },
          data: {
            nodeType: "asset-input", label: "双击预览", assetId: asset.id,
            assetKind: "image", mediaAspectRatio: 1,
            ...(generated ? {
              generatedResult: true, generatedStatus: "succeeded",
              generatedFromNodeId: "source", generatedFromRunId: "preview-fixture",
              generatedOutputIndex: 0,
            } : {}),
            outputs: [{ id: "asset", kind: "image", label: "图片" }],
          },
        }],
        edges: [],
      },
    },
  });
  expect(created.status()).toBe(201);
  return { id, asset };
}

async function doubleClickImage(page: Page) {
  const picture = page.locator('.react-flow__node[data-id="picture"]');
  const img = picture.locator("img");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(picture).not.toHaveClass(/selected/);
  await picture.locator(".previewable-image").dblclick({ delay: 100 });
}

for (const generated of [true, false]) {
  for (const stale of [false, true]) {
    test(`${generated ? "生成图片" : "导入图片"}首次双击预览：${stale ? "素材列表尚未刷新" : "列表已就绪"}`, async ({ page, request }) => {
      const { id, asset } = await fixture(request, generated);
      if (stale) await page.route("**/api/assets", route => route.fulfill({ json: [] }));
      try {
        await page.goto(`/canvas/${id}`);
        await doubleClickImage(page);
        const dialog = page.getByRole("dialog", { name: "素材预览" });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("img")).toHaveAttribute("src", new RegExp(`/api/assets/${asset.id}/content`));
        await expect.poll(() => dialog.locator("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      } finally {
        await page.close();
        await request.delete(`/api/projects/${id}`);
        await request.delete(`/api/assets/${asset.id}`);
      }
    });
  }
}

test("素材详情读取失败时显示错误并允许再次双击重试", async ({ page, request }) => {
  const { id, asset } = await fixture(request, true);
  await page.route("**/api/assets", route => route.fulfill({ json: [] }));
  const endpoint = `**/api/assets/${asset.id}`;
  await page.route(endpoint, route => route.fulfill({ status: 404, json: { error: "素材不存在" } }));
  try {
    await page.goto(`/canvas/${id}`);
    await doubleClickImage(page);
    await expect(page.getByText("素材不存在，无法打开原图", { exact: true })).toBeVisible();
    await page.unroute(endpoint);
    await page.locator('.react-flow__node[data-id="picture"] .previewable-image').dblclick();
    await expect(page.getByRole("dialog", { name: "素材预览" })).toBeVisible();
  } finally {
    await page.close();
    await request.delete(`/api/projects/${id}`);
    await request.delete(`/api/assets/${asset.id}`);
  }
});

test("等待原图时按 Escape 取消，迟到的响应不会重新打开预览", async ({ page, request }) => {
  const { id, asset } = await fixture(request, true);
  await page.route("**/api/assets", route => route.fulfill({ json: [] }));
  const endpoint = `**/api/assets/${asset.id}`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  await page.route(endpoint, async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/canvas/${id}`);
    await doubleClickImage(page);
    await ready;
    const cancelled = page.waitForEvent("requestfailed", {
      predicate: event => new URL(event.url()).pathname === `/api/assets/${asset.id}`,
    });
    await page.keyboard.press("Escape");
    await cancelled;
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.getByRole("dialog", { name: "素材预览" })).toHaveCount(0);
    await page.locator('.react-flow__node[data-id="picture"] .previewable-image').dblclick();
    await expect(page.getByRole("dialog", { name: "素材预览" })).toBeVisible();
  } finally {
    release();
    await page.close();
    await request.delete(`/api/projects/${id}`);
    await request.delete(`/api/assets/${asset.id}`);
  }
});
