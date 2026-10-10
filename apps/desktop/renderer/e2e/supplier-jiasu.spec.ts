import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { remainingVideoModel, type ModelDescriptor } from "@super-canvas/providers";
import { applyJiasuImageCapabilities, JIASU_IMAGE_MODELS } from "@super-canvas/providers/jiasu-image-contract";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const config = { baseUrl: "https://ai.jiasuapi.com/v1", usage: "canvas", modelGroup: "vip", accountKeyGroup: "vip",
  modelScanStatus: "live", scannedModelIds: [...JIASU_IMAGE_MODELS, "sd-2.5-J2"] };
const images = JIASU_IMAGE_MODELS.map((id, index) => applyJiasuImageCapabilities({ provider: "openai", config }, {
  id, name: `佳速图片${index + 1}`, operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true },
}));
const video = remainingVideoModel("jiasu", "sd-2.5-J2", {
  id: "sd-2.5-J2", name: "佳速视频秒价", operations: ["video.generate"], metadata: { canvasRunnable: true },
  pricing: { kind: "tiered", currency: "CNY", billingUnit: "second", checkedAt: "2026-10-09T22:16:09.000Z", confidence: "exact", tiers: [
    { id: "480p", label: "480p", price: 0.4, dimension: "resolution", value: "480p" },
    { id: "720p", label: "720p", price: 0.65, dimension: "resolution", value: "720p" },
    { id: "1080p", label: "1080p", price: 1.1, dimension: "resolution", value: "1080p" },
  ] },
}, { group: "vip" })!;

test.beforeAll(() => expect(process.env.PLAYWRIGHT_BASE_URL, "必须使用隔离测试资料库").toBeFalsy());

async function setup(page: Page, request: APIRequestContext, model: ModelDescriptor, models: ModelDescriptor[]) {
  let submissions = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/runs") && route.request().method() === "POST") { submissions++; return route.abort(); }
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  const connectionResponse = await request.post("/api/providers", { data: { name: "佳速隔离验收", provider: "rest", apiKey: "offline-jiasu-test",
    config: { baseUrl: "https://jiasu-isolated.invalid", defaultModel: model.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models, restrictModels: true } } } });
  expect(connectionResponse.ok()).toBeTruthy();
  const connection = await connectionResponse.json();
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: models,
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  const parameters = Object.fromEntries((model.parameters ?? []).filter(p => p.default !== undefined).map(p => [p.key, p.default]));
  const response = await request.post("/api/canvas", { data: { title: "佳速隔离参数验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "media", type: "workflow",
      position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: {
        nodeType: model.outputKinds?.includes("video") ? "video-generation" : "image-generation", label: "佳速验收",
        provider: "rest", connectionId: connection.id, model: model.id, qualityMode: "custom", parameters, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind: model.outputKinds?.includes("video") ? "video" : "image", label: "结果" }],
      } }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const panel = page.getByRole("dialog", { name: "佳速验收 模型与参数", exact: true });
  const open = async () => { await page.getByRole("button", { name: "打开 佳速验收 模型与参数", exact: true }).click(); await expect(panel).toBeVisible(); };
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  await page.goto(`/canvas/${canvas.id}`); await open();
  return { panel, open, saved, safe: () => { expect(submissions).toBe(0); expect(errors).toEqual([]); } };
}

test("佳速九个图片型号菜单、精确质量尺寸、参数保存恢复", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, images.find(m => m.id === "gpt-image-2-4k")!, images);
  const picker = f.panel.getByRole("combobox", { name: "佳速验收 模型", exact: true });
  await picker.click();
  for (const model of images) await expect(f.panel.getByRole("option", { name: model.name, exact: true })).toBeEnabled();
  await f.panel.getByRole("option", { name: images.find(m => m.id === "gpt-image-2-4k")!.name, exact: true }).click();
  const quality = f.panel.getByRole("combobox", { name: "质量", exact: true });
  await expect(quality.locator("option")).toHaveText(["模型默认", "自动（上游默认）", "low", "medium"]);
  await quality.selectOption("low");
  await expect.poll(async () => (await f.saved()).parameters.quality).toBe("low");
  await page.reload(); await f.open();
  await expect(quality).toHaveValue("low");
  await picker.click();
  await f.panel.getByRole("option", { name: images.find(m => m.id === "gpt-image-2.5-1k")!.name, exact: true }).click();
  const ratio = f.panel.getByRole("combobox", { name: "画面比例", exact: true });
  await ratio.selectOption("3:4");
  await expect.poll(async () => (await f.saved()).parameters.ratio).toBe("3:4");
  await page.reload(); await f.open();
  await expect(ratio).toHaveValue("3:4");
  await expect(quality.locator("option")).toHaveText(["模型默认", "自动（上游默认）"]);
  await page.screenshot({ path: testInfo.outputPath("jiasu-image-parameters.png") }); f.safe();
});

test("佳速视频分辨率秒价按当前时长计算并保存恢复", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, video, [video]);
  const duration = f.panel.getByRole("slider", { name: "视频时长", exact: true });
  await expect(duration).toHaveAttribute("min", "5");
  await expect(duration).toHaveAttribute("max", "30");
  await duration.press("Home");
  const resolution = f.panel.getByRole("combobox", { name: "输出分辨率", exact: true });
  await expect(resolution.locator("option")).not.toContainText(["480p"]);
  await resolution.selectOption("720p");
  const price = f.panel.getByLabel("当前参数价格", { exact: true });
  await expect(price).toContainText("本次预计费用 3.25 CNY");
  await resolution.selectOption("1080p");
  await expect(price).toContainText("本次预计费用 5.5 CNY");
  await expect.poll(async () => (await f.saved()).parameters.resolution).toBe("1080p");
  await page.reload(); await f.open();
  await expect(duration).toHaveValue("5");
  await expect(resolution).toHaveValue("1080p");
  await expect(price).toContainText("本次预计费用 5.5 CNY");
  await page.screenshot({ path: testInfo.outputPath("jiasu-video-parameters.png") }); f.safe();
});
