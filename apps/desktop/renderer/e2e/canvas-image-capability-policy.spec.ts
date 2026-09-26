import { expect, test } from "@playwright/test";
import { effectiveImageCapabilities } from "../lib/supplier-capabilities";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

test("说明支持的每档开放全部比例和自动，最高档开放全部质量，选择保存后可恢复", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000); // Exercise every preset through the debounced save path.
  const group = "image2.5特价";
  const descriptor = effectiveImageCapabilities({
    supplier: { id: "isolated", name: "参数策略验收", supplierKey: "isolated", apiUrl: "https://parameters.invalid/v1", siteUrl: "https://parameters.invalid",
      kind: "newapi", scanStatus: "live", createdAt: "2026-09-23", updatedAt: "2026-09-23",
      catalog: { groups: [{ id: group, label: group, models: [], details: { source: "key-groups", description: "image2.5特价，0.06一张，124k" } }] } },
    connection: { id: "isolated", provider: "openai", config: { modelGroup: group } },
    model: { id: "gpt-image-2.5-all", name: "参数策略验收", operations: ["image.generate"], metadata: { canvasRunnable: true } },
    fingerprint: "isolated",
  }).model;
  const connectionResponse = await request.post("/api/providers", { data: {
    name: "隔离参数策略验收", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { baseUrl: "https://parameters.invalid", defaultModel: descriptor.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } },
  } });
  expect(connectionResponse.ok()).toBeTruthy();
  const connection = await connectionResponse.json();
  const created = await request.post("/api/canvas", { data: { title: "参数策略验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow",
      position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: {
        nodeType: "image-generation", label: "参数策略", provider: "rest", connectionId: connection.id,
        model: descriptor.id, parameters: {}, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }],
      } }],
  } } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
  await page.goto(`/canvas/${canvas.id}`);
  const open = () => page.getByRole("button", { name: "打开 参数策略 模型与参数", exact: true }).click();
  await open();
  const panel = page.getByRole("dialog", { name: "参数策略 模型与参数" });
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
  const sizes = panel.getByLabel("输出分辨率预设", { exact: true });
  const quality = panel.getByLabel("质量", { exact: true });
  await expect(quality).toHaveValue("max");
  const qualities = ["auto", "low", "medium", "high", "xhigh", "max"];
  expect(await quality.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean))).toEqual(qualities);
  for (const tier of ["1K", "2K", "4K"]) {
    await tiers.getByRole("button", { name: tier, exact: true }).click();
    const options = await sizes.locator("option").evaluateAll(options => options.map(option => ({ label: option.textContent ?? "", value: (option as HTMLOptionElement).value })));
    expect(options.filter(option => option.label.startsWith(tier) && option.value)).toHaveLength(11);
    expect(options.some(option => option.value === "auto")).toBe(true);
    for (const option of options.filter(option => option.value && option.value !== "auto")) {
      await sizes.selectOption(option.value);
      await expect.poll(saved).toMatchObject({ size: option.value, size_tier: tier });
    }
    await sizes.selectOption("auto");
    await expect.poll(saved).toMatchObject({ size: "auto", size_tier: tier });
  }
  for (const value of qualities) {
    await quality.selectOption(value);
    await expect.poll(saved).toMatchObject({ quality: value });
  }
  await quality.selectOption("low");
  await expect.poll(saved).toMatchObject({ size: "auto", size_tier: "4K", quality: "low" });
  await page.reload(); await open();
  await expect(sizes).toHaveValue("auto");
  await expect(quality).toHaveValue("low");
  await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("all-ratios-and-qualities.png") });
  await tiers.getByRole("button", { name: "自动", exact: true }).click();
  await expect.poll(async () => (await saved()).size_tier).toBeUndefined();
  expect(submissions).toBe(0);
});
