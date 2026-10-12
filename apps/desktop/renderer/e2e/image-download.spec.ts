import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import sharp from "sharp";

const width = 800;
const height = 400;
const filename = "generated-download.v1.png";

async function fixture(request: APIRequestContext) {
  // Larger than the canvas thumbnail, with both transparent and opaque pixels.
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 180;
    pixels[index + 1] = 40;
    pixels[index + 2] = 70;
    pixels[index + 3] = (index / 4) % width < width / 2 ? 0 : 255;
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const uploaded = await request.post(`/api/assets/upload?name=${filename}`, {
    headers: { "content-type": "image/png" },
    data: bytes,
  });
  expect(uploaded.status()).toBe(201);
  const asset = await uploaded.json() as { id: string };
  const id = `image-download-${randomUUID()}`;
  const created = await request.post("/api/canvas", {
    data: {
      id,
      title: id,
      graph: {
        schemaVersion: 1,
        viewport: { x: 20, y: 20, zoom: 1 },
        nodes: [{
          id: "picture", type: "workflow", position: { x: 60, y: 90 },
          style: { width: 400, height: 200 },
          data: {
            nodeType: "asset-input", label: "格式下载验收", assetId: asset.id,
            assetKind: "image", mediaAspectRatio: width / height,
            generatedResult: true, generatedStatus: "succeeded",
            generatedFromNodeId: "source", generatedFromRunId: "download-fixture",
            generatedOutputIndex: 0,
            outputs: [{ id: "asset", kind: "image", label: "图片" }],
          },
        }],
        edges: [],
      },
    },
  });
  expect(created.status()).toBe(201);
  return { id, asset, bytes };
}

async function openCanvas(page: Page, id: string) {
  await page.goto(`/canvas/${id}`);
  const picture = page.locator('.react-flow__node[data-id="picture"]');
  await expect(picture.locator("img")).toBeVisible();
  await expect.poll(() => picture.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  return picture;
}

async function downloadImage(page: Page, testInfo: TestInfo, outputName: string) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("dialog", { name: "下载图片", exact: true }).getByRole("button", { name: "下载", exact: true }).click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  const path = testInfo.outputPath(outputName);
  await download.saveAs(path);
  return { filename: download.suggestedFilename(), bytes: await readFile(path) };
}

test("生成图片可下载原文件、PNG、JPG 和 WebP，真实编码与原始尺寸一致", async ({ page, request }, testInfo) => {
  const { id, asset, bytes } = await fixture(request);
  try {
    const picture = await openCanvas(page, id);
    await picture.locator(".previewable-image").click();
    const trigger = page.getByRole("button", { name: "下载 格式下载验收", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "下载图片", exact: true });
    const format = dialog.getByRole("combobox", { name: "下载格式", exact: true });
    await expect(format).toHaveValue("original");
    const originalDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载", exact: true }).click();
    const original = await originalDownload;
    const originalPath = `/api/assets/${asset.id}/content?download=1`;
    // Native downloads do not inherit the browser harness's desktop token.
    // Like the music regression, check the UI target and authenticated bytes
    // separately; Electron's native download handler supplies auth in the app.
    expect(original.url()).toBe(new URL(originalPath, page.url()).toString());
    const originalResponse = await request.get(originalPath);
    expect(originalResponse.ok()).toBe(true);
    expect(originalResponse.headers()["content-type"]).toContain("image/png");
    expect(originalResponse.headers()["content-disposition"]).toContain(filename);
    expect(await originalResponse.body()).toEqual(bytes);
    await expect(dialog).toHaveCount(0);

    for (const extension of ["png", "jpg", "webp"] as const) {
      await trigger.click();
      await format.selectOption(extension);
      const responsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === `/api/assets/${asset.id}/content`
          && url.searchParams.get("download") === "1"
          && url.searchParams.get("format") === extension;
      });
      const result = await downloadImage(page, testInfo, `converted.${extension}`);
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain(`image/${extension === "jpg" ? "jpeg" : extension}`);
      expect(result.filename).toBe(`generated-download.v1.${extension}`);
      expect(await sharp(result.bytes).metadata()).toMatchObject({
        format: extension === "jpg" ? "jpeg" : extension,
        width, height, hasAlpha: extension !== "jpg",
      });
      const sample = await sharp(result.bytes).ensureAlpha().extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
      if (extension === "jpg") expect([...sample]).toEqual([255, 255, 255, 255]);
      else expect(sample[3]).toBe(0);
      await expect(dialog).toHaveCount(0);
    }

    // Converting a download must not replace the original saved asset.
    const originalAfterConversions = await request.get(`/api/assets/${asset.id}/content`);
    expect(await originalAfterConversions.body()).toEqual(bytes);
  } finally {
    await page.close();
    await request.delete(`/api/projects/${id}`);
    await request.delete(`/api/assets/${asset.id}`);
  }
});

test("原图预览可选择下载格式，Escape 只关闭下载弹窗并返回焦点", async ({ page, request }, testInfo) => {
  const { id, asset } = await fixture(request);
  try {
    const picture = await openCanvas(page, id);
    await picture.locator(".previewable-image").dblclick({ delay: 100 });
    const preview = page.getByRole("dialog", { name: "素材预览", exact: true });
    await expect(preview).toBeVisible();
    const trigger = preview.getByRole("button", { name: "下载图片", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "下载图片", exact: true });
    await dialog.getByRole("combobox", { name: "下载格式", exact: true }).selectOption("jpg");
    await expect(dialog).toContainText(/透明.*白/);
    await page.screenshot({ path: testInfo.outputPath("download-format-preview.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("download-format-mobile.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(preview).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 720 });
    await trigger.click();
    await dialog.getByRole("combobox", { name: "下载格式", exact: true }).selectOption("png");
    const result = await downloadImage(page, testInfo, "preview-download.png");
    expect(result.filename).toBe(filename);
    expect(await sharp(result.bytes).metadata()).toMatchObject({ format: "png", width, height, hasAlpha: true });
    await expect(dialog).toHaveCount(0);
    await expect(preview).toBeVisible();
  } finally {
    await page.close();
    await request.delete(`/api/projects/${id}`);
    await request.delete(`/api/assets/${asset.id}`);
  }
});

test("转换失败保留格式与弹窗，用户可重试下载", async ({ page, request }, testInfo) => {
  const { id, asset } = await fixture(request);
  let attempts = 0;
  await page.route(`**/api/assets/${asset.id}/content?*`, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("format") !== "webp") return route.continue();
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: "图片转换暂时失败，请重试" } });
    return route.continue();
  });
  try {
    const picture = await openCanvas(page, id);
    await picture.locator(".previewable-image").click();
    await page.getByRole("button", { name: "下载 格式下载验收", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "下载图片", exact: true });
    const format = dialog.getByRole("combobox", { name: "下载格式", exact: true });
    await format.selectOption("webp");
    await dialog.getByRole("button", { name: "下载", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("图片转换暂时失败，请重试");
    await expect(format).toHaveValue("webp");
    await expect(dialog.getByRole("button", { name: "下载", exact: true })).toBeEnabled();
    expect(attempts).toBe(1);
    const result = await downloadImage(page, testInfo, "retried.webp");
    expect(attempts).toBe(2);
    expect(result.filename).toBe("generated-download.v1.webp");
    expect(await sharp(result.bytes).metadata()).toMatchObject({ format: "webp", width, height });
    await expect(dialog).toHaveCount(0);
  } finally {
    await page.close();
    await request.delete(`/api/projects/${id}`);
    await request.delete(`/api/assets/${asset.id}`);
  }
});
