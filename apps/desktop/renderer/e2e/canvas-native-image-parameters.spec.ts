import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import { miaowuCatalogFromPricing, miaowuConnectorForModels } from "../lib/miaowu-catalog";

// Public directory data only. This regression never uses an account key or
// submits generation; each canvas lives in the Playwright isolated profile.
const pricing = JSON.parse(readFileSync(new URL("../lib/miaowu-catalog-20261008.fixture.json", import.meta.url), "utf8"));
const catalog = miaowuCatalogFromPricing(pricing);
const ids = ["gpt-image-2.5-sunburs", "Image-nano-banana-pro", "wan3.0-video"];
const models: ModelDescriptor[] = ids.map(id => {
  const model = catalog.models.find(item => item.id === id);
  if (!model) throw new Error(`Public Miaowu fixture is missing ${id}`);
  return model;
});

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "Native media parameters require the isolated test profile").toBeFalsy();
});

async function setup(page: Page, request: APIRequestContext, id: string, kind: "image" | "video") {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const label = kind === "image" ? "原生图片参数验收" : "原生视频参数验收";
  const errors: string[] = [];
  let submissions = 0, upstreamRequests = 0, modelReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://api.miaowuai.store/**", route => { upstreamRequests++; return route.abort(); });
  await page.route("https://native-image-parameters.invalid/**", route => { upstreamRequests++; return route.abort(); });
  await page.route(/\/api\/runs(?:\?.*)?$/u, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade", route => route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } }));
  const created = await request.post("/api/providers", { data: {
    name: `原生媒体参数隔离验收 ${id}`, provider: "rest",
    config: { baseUrl: "https://native-image-parameters.invalid", defaultModel: id, usage: "canvas",
      connector: { ...miaowuConnectorForModels(models), restrictModels: true } },
  } });
  expect(created.ok()).toBeTruthy();
  const stored = await created.json();
  const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { ...stored.config, supplierKey: "isolated-native-media", supplierName: "喵呜原生参数隔离验收",
      modelGroup: "default", accountKeyGroup: "default", modelScanStatus: "live", modelScanComplete: true,
      modelCatalogModels: models, scannedModelIds: models.map(model => model.id) } };
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [connection] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => {
    modelReads++;
    return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  const parameters = kind === "image" ? { resolution: "1080p", aspect_ratio: "1:1" }
    : { resolution: "720p", aspect_ratio: "16:9", duration: 5 };
  const response = await request.post("/api/canvas", { data: { title: `${label} ${id}`, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "native-media", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: `${kind}-generation`, label, provider: "rest", connectionId: connection.id, model: id,
        qualityMode: "custom", parameters, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "result", kind, label: "结果" }] },
    }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const open = async () => {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
  };
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  const safe = () => {
    expect({ submissions, upstreamRequests, errors }).toEqual({ submissions: 0, upstreamRequests: 0, errors: [] });
    expect(modelReads).toBeGreaterThan(0);
  };
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  return { panel, open, saved, safe, label };
}

for (const [id, name, tierLabels] of [
  ["gpt-image-2.5-sunburs", "GPT Image 2.5 Sunburst", ["标准", "2K", "4K"]],
  ["Image-nano-banana-pro", "Nano Banana Pro", ["标准", "2K"]],
] as const) {
  test(`${name} 使用图片档位与实际像素，保留供应商原生值并保存恢复`, async ({ page, request }, testInfo) => {
    const f = await setup(page, request, id, "image");
    const tiers = f.panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    const ratio = f.panel.getByRole("combobox", { name: "画面比例", exact: true });
    const width = f.panel.getByLabel("图片宽度", { exact: true });
    const height = f.panel.getByLabel("图片高度", { exact: true });
    const assertDimensions = async (w: number, h: number) => {
      await expect(width).toHaveValue(String(w));
      await expect(height).toHaveValue(String(h));
      await expect(width).toHaveJSProperty("readOnly", true);
      await expect(height).toHaveJSProperty("readOnly", true);
    };
    const assertNative = async (resolution: string, aspectRatio: string) => {
      await expect.poll(async () => (await f.saved()).parameters).toEqual({ resolution, aspect_ratio: aspectRatio });
    };
    try {
      const picker = f.panel.getByRole("combobox", { name: `${f.label} 模型`, exact: true });
      await expect(picker).toContainText(name);
      await expect(picker).toContainText(`ID: ${id}`);
      await expect(tiers.getByRole("button")).toHaveText([...tierLabels]);
      await expect(f.panel.getByRole("button", { name: "1080p", exact: true })).toHaveCount(0);
      await expect(f.panel.getByRole("option", { name: "1080p", exact: true })).toHaveCount(0);
      await expect(f.panel.getByRole("combobox", { name: "质量", exact: true })).toHaveCount(0);
      await expect(f.panel.getByRole("combobox", { name: "输出分辨率", exact: true })).toHaveCount(0);
      await expect(tiers.getByRole("button", { name: "标准", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(ratio).toHaveValue("1:1");
      expect(await ratio.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean)))
        .toEqual(["1:1", "16:9", "9:16", "4:3", "3:4"]);
      await assertDimensions(1080, 1080);
      await assertNative("1080p", "1:1");

      await tiers.getByRole("button", { name: "2K", exact: true }).click();
      await assertDimensions(1440, 1440);
      await ratio.selectOption("16:9");
      await assertDimensions(2560, 1440);
      await assertNative("2K", "16:9");
      const highest = id === "gpt-image-2.5-sunburs" ? "4K" : "2K";
      if (highest === "4K") {
        await tiers.getByRole("button", { name: "4K", exact: true }).click();
        await assertDimensions(3840, 2160);
      }
      await ratio.selectOption("9:16");
      await assertDimensions(highest === "4K" ? 2160 : 1440, highest === "4K" ? 3840 : 2560);
      await assertNative(highest, "9:16");
      await page.reload(); await f.open();
      await expect(tiers.getByRole("button", { name: highest, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(ratio).toHaveValue("9:16");
      await assertDimensions(highest === "4K" ? 2160 : 1440, highest === "4K" ? 3840 : 2560);
      await f.panel.screenshot({ path: testInfo.outputPath(`${id}-native-image-parameters.png`) });

      await tiers.getByRole("button", { name: "标准", exact: true }).click();
      await assertDimensions(1080, 1920);
      await assertNative("1080p", "9:16");
      await page.reload(); await f.open();
      await expect(tiers.getByRole("button", { name: "标准", exact: true })).toHaveAttribute("aria-pressed", "true");
      await assertDimensions(1080, 1920);
      await assertNative("1080p", "9:16");
    } finally { f.safe(); }
  });
}

test("视频保留 1080p 分辨率名称及原生保存值", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, "wan3.0-video", "video");
  try {
    const resolution = f.panel.getByRole("combobox", { name: "输出分辨率", exact: true });
    await expect(resolution.getByRole("option", { name: "1080p", exact: true })).toHaveCount(1);
    await expect(f.panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true })).toHaveCount(0);
    await resolution.selectOption("1080p");
    await expect.poll(async () => (await f.saved()).parameters.resolution).toBe("1080p");
    await page.reload(); await f.open();
    await expect(resolution).toHaveValue("1080p");
    await f.panel.screenshot({ path: testInfo.outputPath("video-native-1080p-parameters.png") });
  } finally { f.safe(); }
});
