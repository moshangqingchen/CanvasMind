import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createJpegWithExifThumbnailFixture } from "../app/api/assets/jpeg-test-fixture";

for (const failure of ["none", "preview", "original"] as const) {
  test(`导入含缩略图的 JPEG：${failure}`, async ({ page, request }) => {
    const fixture = await createJpegWithExifThumbnailFixture();
    const uploaded = await request.post(
      "/api/assets/upload?name=exif-regression.jpg",
      {
        headers: { "content-type": "image/jpeg" },
        data: Buffer.from(fixture.bytes),
      },
    );
    expect(uploaded.status()).toBe(201);
    const asset = (await uploaded.json()) as { id: string; size: number };
    let replacement: { id: string } | undefined;
    if (failure !== "none") {
      const response = await request.post("/api/assets/upload?name=replacement.jpg", {
        headers: { "content-type": "image/jpeg" },
        data: Buffer.from(fixture.bytes),
      });
      expect(response.status()).toBe(201);
      replacement = await response.json() as { id: string };
    }
    expect(asset.size).toBe(fixture.bytes.length);
    const content = await request.get(`/api/assets/${asset.id}/content`);
    expect(await content.body()).toEqual(Buffer.from(fixture.bytes));
    const canvasId = `jpeg-regression-${randomUUID()}`;
    const created = await request.post("/api/canvas", {
      data: {
        id: canvasId,
        title: canvasId,
        graph: {
          schemaVersion: 1,
          viewport: { x: 20, y: 20, zoom: 1 },
          nodes: [
            {
              id: "source",
              type: "workflow",
              position: { x: 60, y: 90 },
              style: { width: 300, height: 300 },
              data: {
                nodeType: "asset-input",
                label: "EXIF原图",
                assetId: asset.id,
                assetKind: "image",
                outputs: [{ id: "asset", kind: "image", label: "图片" }],
              },
            },
            {
              id: "generator",
              type: "workflow",
              position: { x: 430, y: 90 },
              data: {
                nodeType: "image-generation",
                label: "图片参考",
                provider: "fake",
                connectionId: "fake-default",
                model: "fake-image-v1",
                inputs: [
                  {
                    id: "references",
                    kind: "image[]",
                    label: "参考图",
                    multiple: true,
                  },
                ],
                outputs: [{ id: "images", kind: "image", label: "图片" }],
                parts: [{ type: "text", text: "导入预览验收，不执行生成。" }],
              },
            },
          ],
          edges: [
            {
              id: "reference",
              source: "source",
              sourceHandle: "asset",
              target: "generator",
              targetHandle: "references",
            },
          ],
        },
      },
    });
    expect(created.status()).toBe(201);
    let originalRequests = 0;
    page.on("request", (event) => {
      if (new URL(event.url()).pathname === `/api/assets/${asset.id}/content`)
        originalRequests += 1;
    });
    if (failure !== "none")
      await page.route(`**/api/assets/${asset.id}/preview?*`, (route) =>
        route.fulfill({ status: 500, json: { error: "test preview failure" } }),
      );
    if (failure === "original")
      await page.route(`**/api/assets/${asset.id}/content`, (route) =>
        route.fulfill({
          status: 404,
          json: { error: "test original missing" },
        }),
      );
    try {
      await page.goto(`/canvas/${canvasId}`);
      const source = page.locator('.react-flow__node[data-id="source"]');
      const linked = page.locator(
        '.react-flow__node[data-id="generator"] .node-linked-asset.image',
      );
      if (failure === "original") {
        await expect(
          source.getByText("图片加载失败", { exact: true }),
        ).toBeVisible();
        await expect(
          linked.getByText("加载失败", { exact: true }),
        ).toBeVisible();
        await expect(source.locator("img")).toHaveCount(0);
        await expect(linked.locator("img")).toHaveCount(0);
      } else {
        for (const region of [source, linked]) {
          const img = region.locator("img");
          await expect(img).toBeVisible();
          await expect
            .poll(() =>
              img.evaluate((element: HTMLImageElement) => element.naturalWidth),
            )
            .toBeGreaterThan(0);
          if (failure === "preview")
            await expect(img).toHaveAttribute(
              "data-asset-preview-state",
              "original",
            );
        }
      }
      expect(originalRequests).toBe(failure === "none" ? 0 : 1);
      if (replacement) {
        // Finish the renderer's aspect-ratio save before editing its canvas
        // through the API; a pagehide save must not overwrite the replacement.
        await page.getByRole("button", { name: "返回主界面", exact: true }).click();
        await expect(page.getByRole("heading", { name: "我的画布" })).toBeVisible();
        const saved = await (await request.get(`/api/canvas/${canvasId}`)).json();
        for (const node of saved.graph.nodes) if (node.data.assetId === asset.id) node.data.assetId = replacement.id;
        expect((await request.put(`/api/canvas/${canvasId}`, { data: { graph: saved.graph } })).ok()).toBeTruthy();
        await page.goto(`/canvas/${canvasId}`);
        const changedImage = source.locator("img");
        await expect(changedImage).toHaveAttribute("src", new RegExp(`/api/assets/${replacement.id}/preview`));
        await expect(changedImage).toHaveAttribute("data-asset-preview-state", "preview");
        await expect.poll(() => changedImage.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(160);
        await source.locator(".asset-node-preview").click();
        await expect(changedImage).toHaveAttribute("src", /size=640$/);
        await expect.poll(() => changedImage.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(fixture.width);
        await expect(linked.locator("img")).toHaveAttribute("src", new RegExp(`/api/assets/${replacement.id}/preview`));
        await expect(source.getByText("图片加载失败", { exact: true })).toHaveCount(0);
      }
      await page.screenshot({
        path: test.info().outputPath(`jpeg-${failure}.png`),
      });
    } finally {
      await page.close();
      await request.delete(`/api/projects/${canvasId}`);
      await request.delete(`/api/assets/${asset.id}`);
      if (replacement) await request.delete(`/api/assets/${replacement.id}`);
    }
  });
}
