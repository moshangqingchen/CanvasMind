import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function fixture(request: APIRequestContext, generated: boolean, copies = 1) {
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
        nodes: Array.from({ length: copies }, (_, index) => ({
          id: index === 0 ? "picture" : `picture-${index}`,
          type: "workflow", position: { x: 60 + index * 360, y: 90 },
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
        })),
        edges: [],
      },
    },
  });
  expect(created.status()).toBe(201);
  return { id, asset };
}

async function observeOriginalObjectUrls(page: Page) {
  await page.addInitScript(() => {
    const counters = { created: [] as string[], revoked: [] as string[] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => {
      const url = create(value);
      if (value instanceof Blob && value.type.startsWith("image/"))
        counters.created.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      if (counters.created.includes(url)) counters.revoked.push(url);
      revoke(url);
    };
    (window as typeof window & { __imagePreviewObjectUrls?: typeof counters })
      .__imagePreviewObjectUrls = counters;
  });
}

async function originalObjectUrls(page: Page) {
  return page.evaluate(() => {
    const counters = (window as typeof window & {
      __imagePreviewObjectUrls?: { created: string[]; revoked: string[] };
    }).__imagePreviewObjectUrls;
    if (!counters) throw new Error("Image object URL observer was not installed");
    return { created: [...counters.created], revoked: [...counters.revoked] };
  });
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

for (const emptyOriginal of [false, true]) {
  test(`生成图片缩略图读取失败：${emptyOriginal ? "空结果显示错误" : "回退原图"}`, async ({ page, request }) => {
    const { id, asset } = await fixture(request, true);
    await page.route(`**/api/assets/${asset.id}/preview?*`, route =>
      route.fulfill({ status: 500, json: { error: "test preview failure" } }),
    );
    let originalRequests = 0;
    page.on("request", event => {
      if (new URL(event.url()).pathname === `/api/assets/${asset.id}/content`)
        originalRequests += 1;
    });
    if (emptyOriginal)
      await page.route(`**/api/assets/${asset.id}/content`, route =>
        route.fulfill({ contentType: "image/png", body: Buffer.alloc(0) }),
      );
    try {
      await page.goto(`/canvas/${id}`);
      const picture = page.locator('.react-flow__node[data-id="picture"]');
      if (emptyOriginal) {
        await expect(picture.getByText("图片加载失败", { exact: true })).toBeVisible();
        await expect(picture.getByText("图片为空、损坏或无法读取，请查看任务详情", { exact: true })).toBeVisible();
        await expect(picture.locator("img")).toHaveCount(0);
      } else {
        const img = picture.locator("img");
        await expect(img).toHaveAttribute("data-asset-preview-state", "original");
        await expect.poll(() => img.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
        expect(originalRequests).toBe(1);
        await picture.locator(".previewable-image").dblclick({ delay: 100 });
        const dialog = page.getByRole("dialog", { name: "素材预览" });
        await expect(dialog).toBeVisible();
        await expect.poll(() => dialog.locator("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
      }
      if (emptyOriginal) expect(originalRequests).toBe(1);
    } finally {
      await page.close();
      await request.delete(`/api/projects/${id}`);
      await request.delete(`/api/assets/${asset.id}`);
    }
  });
}

test("原图非空但解码失败时，节点仍挂载也及时释放 Blob URL", async ({ page, request }) => {
  const { id, asset } = await fixture(request, true);
  await observeOriginalObjectUrls(page);
  await page.route(`**/api/assets/${asset.id}/preview?*`, route =>
    route.fulfill({ status: 500, json: { error: "test preview failure" } }),
  );
  let originalRequests = 0;
  await page.route(`**/api/assets/${asset.id}/content`, route => {
    originalRequests++;
    return route.fulfill({ contentType: "image/png", body: Buffer.from("nonempty damaged PNG") });
  });
  try {
    await page.goto(`/canvas/${id}`);
    const picture = page.locator('.react-flow__node[data-id="picture"]');
    await expect(picture.getByText("图片加载失败", { exact: true })).toBeVisible();
    await expect(picture).toBeVisible();
    await expect(picture.locator("img")).toHaveCount(0);
    await expect.poll(async () => {
      const urls = await originalObjectUrls(page);
      return { created: urls.created.length, revoked: urls.revoked.length };
    }).toEqual({ created: 1, revoked: 1 });
    const urls = await originalObjectUrls(page);
    expect(urls.revoked).toEqual(urls.created);
    expect(originalRequests).toBe(1);
  } finally {
    await page.close();
    await request.delete(`/api/projects/${id}`);
    await request.delete(`/api/assets/${asset.id}`);
  }
});

test("共享原图的一张图片失败或移除，不会提前释放其他图片的租约", async ({ page, request }) => {
  const { id, asset } = await fixture(request, false, 2);
  await observeOriginalObjectUrls(page);
  await page.route(`**/api/assets/${asset.id}/preview?*`, route =>
    route.fulfill({ status: 500, json: { error: "test preview failure" } }),
  );
  let originalRequests = 0;
  page.on("request", event => {
    if (new URL(event.url()).pathname === `/api/assets/${asset.id}/content`)
      originalRequests++;
  });
  try {
    await page.goto(`/canvas/${id}`);
    const first = page.locator('.react-flow__node[data-id="picture"]');
    const second = page.locator('.react-flow__node[data-id="picture-1"]');
    for (const node of [first, second]) {
      await expect(node.locator("img")).toHaveAttribute("data-asset-preview-state", "original");
      await expect.poll(() => node.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    }
    const sharedUrl = await second.locator("img").getAttribute("src");
    expect(sharedUrl).toMatch(/^blob:/);
    await expect(first.locator("img")).toHaveAttribute("src", sharedUrl!);
    expect(originalRequests).toBe(1);
    expect(await originalObjectUrls(page)).toEqual({ created: [sharedUrl], revoked: [] });

    // The original error path must release just this consumer. Keep the second
    // consumer alive, then unmount the failed one to check idempotent cleanup.
    await first.locator("img").dispatchEvent("error");
    await expect(first.getByText("图片加载失败", { exact: true })).toBeVisible();
    await first.locator(".node-card").click({ position: { x: 30, y: 20 } });
    await page.keyboard.press("Delete");
    await expect(first).toHaveCount(0);
    await expect(second).toBeVisible();
    expect(await page.evaluate(async url => fetch(url!).then(response => response.ok).catch(() => false), sharedUrl)).toBe(true);
    expect(await originalObjectUrls(page)).toEqual({ created: [sharedUrl], revoked: [] });

    await second.locator(".node-card").click({ position: { x: 30, y: 20 } });
    await page.keyboard.press("Delete");
    await expect(second).toHaveCount(0);
    await expect.poll(() => originalObjectUrls(page)).toEqual({ created: [sharedUrl], revoked: [sharedUrl] });
  } finally {
    await page.close();
    await request.delete(`/api/projects/${id}`);
    await request.delete(`/api/assets/${asset.id}`);
  }
});
