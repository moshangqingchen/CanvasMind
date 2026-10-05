import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const label = "生成模式验收";
const image2: ModelDescriptor = {
  id: "gpt-image-2", name: "Image 2 模式验收", operations: ["image.generate", "image.edit"],
  inputKinds: ["text", "image[]"], outputKinds: ["image"], metadata: { canvasRunnable: true },
  parameters: [{ key: "output_format", label: "输出格式", control: "select", default: "png",
    options: ["png", "jpeg", "webp"].map(value => ({ value, label: value })) }],
};
const image25: ModelDescriptor = { ...image2, id: "gpt-image-2.5-flare", name: "Image 2.5 模式验收" };
const b4 = "B4-GPT生图原生渠道V3（高质量）";
const b1 = "B1-GPT生图原生渠道V1";

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "生成模式测试只能使用 globalSetup 创建的隔离数据目录").toBeFalsy();
});

async function setup(page: Page, request: APIRequestContext, kind: "secure" | "monster") {
  await page.setViewportSize({ width: 1600, height: 1080 });
  const errors: string[] = [];
  let submissions = 0, upstreamRequests = 0, modelReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/https:\/\/(?:token\.secure-skill\.com|api\.eaheng\.com)\//, route => {
    upstreamRequests++;
    return route.abort();
  });
  await page.route(/\/api\/runs(?:\?.*)?$/, async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/, route => route.fulfill({ json: [] }));

  const models = kind === "secure" ? [image2, image25] : [image2];
  const groups = kind === "secure" ? ["default"] : [b4, b1];
  const connections: ProviderConnectionView[] = [];
  for (const group of groups) {
    // The backend retains only a non-network REST fixture. Browser overrides
    // supply the actual capability boundary; no real supplier key is stored.
    const response = await request.post("/api/providers", { data: {
      name: `模式隔离验收 ${kind} ${group}`, provider: "rest", apiKey: "isolated-no-paid-generation",
      config: { baseUrl: "https://output-mode.invalid", defaultModel: image2.id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models } },
    } });
    expect(response.ok()).toBeTruthy();
    const stored = await response.json();
    const connection: ProviderConnectionView = {
      ...stored, provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
      config: { supplierKey: `custom-output-mode-${kind}`, supplierName: `模式测试 ${kind}`, usage: "canvas",
        baseUrl: kind === "secure" ? "https://token.secure-skill.com/v1" : "https://api.eaheng.com/v1",
        modelGroup: group, accountKeyGroup: group, defaultModel: image2.id,
        modelScanStatus: "live", modelCatalogModels: models, scannedModelIds: models.map(model => model.id) },
    };
    connections.push(connection);
    await page.route(`**/api/providers/${connection.id}/models*`, route => {
      modelReads++;
      return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } });
    });
  }
  await page.route(/\/api\/providers(?:\?.*)?$/, async route => {
    if (route.request().method() === "GET") await route.fulfill({ json: connections });
    else await route.continue();
  });
  const response = await request.post("/api/canvas", { data: { title: `生成模式 ${kind} 隔离回归`, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "output-mode", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label, provider: "openai", connectionId: connections[0]!.id,
        model: image2.id, qualityMode: "custom", parameters: { background: "opaque", output_format: "jpeg", output_compression: 80 },
        parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  const open = () => page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const mode = panel.getByRole("group", { name: "生成模式", exact: true });
  const normal = mode.getByRole("button", { name: "普通模式", exact: true });
  const transparent = mode.getByRole("button", { name: "透明模式", exact: true });
  const safe = () => {
    expect({ submissions, upstreamRequests }).toEqual({ submissions: 0, upstreamRequests: 0 });
    expect(errors).toEqual([]);
    expect(modelReads).toBeGreaterThan(0);
  };
  return { panel, normal, transparent, saved, open, connections, safe };
}

test("普通与透明模式显示、PNG 参数持久化，切换不支持的型号恢复普通模式", async ({ page, request }, info) => {
  const f = await setup(page, request, "secure");
  try {
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");
    await expect(f.transparent).toBeVisible();
    await f.transparent.click();
    await expect(f.transparent).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ background: "transparent", output_format: "png" });
    await expect.poll(async () => Object.hasOwn((await f.saved()).parameters, "output_compression")).toBe(false);
    await page.reload(); await f.open();
    await expect(f.transparent).toHaveAttribute("aria-pressed", "true");
    await expect(f.panel.getByText("透明背景 · PNG 原图", { exact: true })).toBeVisible();
    await f.normal.click();
    await expect.poll(async () => (await f.saved()).parameters.background).toBe("opaque");
    await page.reload(); await f.open();
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");

    await f.transparent.click();
    await expect.poll(async () => (await f.saved()).parameters.background).toBe("transparent");
    const picker = f.panel.getByRole("combobox", { name: `${label} 模型`, exact: true });
    await picker.click();
    await f.panel.getByRole("option", { name: image25.name, exact: true }).click();
    await expect.poll(async () => (await f.saved()).model).toBe(image25.id);
    await expect(f.transparent).toHaveCount(0);
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Object.hasOwn((await f.saved()).parameters, "background")).toBe(false);
    await page.reload(); await f.open();
    await expect(picker).toContainText(image25.name);
    await expect(f.transparent).toHaveCount(0);
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");

    await picker.click();
    await f.panel.getByRole("option", { name: image2.name, exact: true }).click();
    await expect(f.transparent).toBeVisible();
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await f.saved()).parameters.background).toBe("opaque");
    await f.panel.screenshot({ path: info.outputPath("image-output-mode.png") });
  } finally { f.safe(); }
});

test("同型号切换精确供应商分组，未支持组只显示普通模式并保存选择", async ({ page, request }, info) => {
  const f = await setup(page, request, "monster");
  try {
    await f.transparent.click();
    await expect.poll(async () => (await f.saved()).parameters.background).toBe("transparent");
    const group = f.panel.getByRole("combobox", { name: `${label} 模型群组`, exact: true });
    await group.selectOption(b1);
    await expect.poll(async () => (await f.saved()).connectionId).toBe(f.connections[1]!.id);
    await expect(f.transparent).toHaveCount(0);
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Object.hasOwn((await f.saved()).parameters, "background")).toBe(false);
    await page.reload(); await f.open();
    await expect(group).toHaveValue(b1);
    await expect(f.transparent).toHaveCount(0);
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");

    await group.selectOption(b4);
    await expect.poll(async () => (await f.saved()).connectionId).toBe(f.connections[0]!.id);
    await expect(f.transparent).toBeVisible();
    await expect(f.normal).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await f.saved()).parameters.background).toBe("opaque");
    await f.panel.screenshot({ path: info.outputPath("image-output-mode-group.png") });
  } finally { f.safe(); }
});
