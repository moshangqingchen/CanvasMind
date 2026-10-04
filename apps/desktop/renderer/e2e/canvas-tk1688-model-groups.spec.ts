import { expect, test } from "@playwright/test";
import { parseTk1688Marketplace } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

test("词元先选择基础型号再比较商家，保留完整型号并保存恢复", async ({ page, request }, testInfo) => {
  const base = "gpt-image-2.5-sunburst", other = "gpt-image-2";
  const items = [
    { base_model: base, alias: `${base}@s1c23`, description: "生图1K", input_price_usd: 0.0015 },
    { base_model: base, alias: `${base}@s47c261`, description: "Adobe支持原生4K(3840*2160)，不支持N。", input_price_usd: 0.03 },
    { base_model: other, alias: `${other}@s2c24`, description: "生图1K", input_price_usd: 0.002 },
  ].map(row => ({ ...row, charge_type: "per_request", status: "active", channel_alive: true }));
  const models = parseTk1688Marketplace({ success: true, data: { total: items.length, items } }, undefined,
    { keyModelIds: [base, other], accountModelIds: items.map(item => item.alias) }).models;
  models.push({ id: "gpt-image-2.5-flare", name: "未附商家资料的型号", operations: ["image.generate"], metadata: { canvasRunnable: true } });
  const savedMerchant = `${base}@s47c261`;
  const connected = await request.post("/api/providers", { data: {
    name: "词元分组隔离验收", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { baseUrl: "https://api.tk1688.com/v1", defaultModel: savedMerchant,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models } },
  } });
  expect(connected.ok()).toBeTruthy();
  const connection = await connected.json();
  const created = await request.post("/api/canvas", { data: { title: "词元分组验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "image", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label: "词元分组选型", provider: "rest", connectionId: connection.id,
        model: savedMerchant, parameters: {}, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: models }));
  let submitted = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submitted++; await route.abort(); }
    else await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`/canvas/${canvas.id}`);
  const openPanel = () => page.getByRole("button", { name: "打开 词元分组选型 模型与参数", exact: true }).click();
  await openPanel();
  const panel = page.getByRole("dialog", { name: "词元分组选型 模型与参数" });
  const picker = panel.getByRole("combobox", { name: "词元分组选型 模型", exact: true });
  await expect(picker).toContainText("商家 47 · 渠道 261");
  await picker.click();
  const list = panel.getByRole("listbox");
  await expect(list.getByRole("option")).toHaveCount(4); // Automatic default + two families + an ungrouped entry.
  await expect(list.getByRole("option", { name: base, exact: true })).toHaveCount(1);
  await list.getByRole("option", { name: base, exact: true }).click();
  await expect(list.getByRole("option")).toHaveCount(3); // Smart + two merchants.
  await expect(list.getByRole("option", { name: "商家 47 · 渠道 261", exact: true })).toContainText("固定 3840×2160");
  const readNode = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  expect((await readNode()).model).toBe(savedMerchant); // Browsing a family never changes the saved route.
  await panel.getByRole("button", { name: "返回模型", exact: true }).click();
  await panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }).fill("4K");
  await expect(panel.getByRole("button", { name: "使用手动模型 ID：4K", exact: true })).toHaveCount(0);
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option", { name: base, exact: true }).click();
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await panel.screenshot({ path: testInfo.outputPath("tk1688-grouped-routes.png") });
  await panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }).fill("");
  await list.getByRole("option", { name: "商家 1 · 渠道 23", exact: true }).click();
  await expect.poll(async () => (await readNode()).model).toBe(`${base}@s1c23`);
  await page.reload();
  await openPanel();
  await expect(picker).toContainText("商家 1 · 渠道 23");
  expect((await readNode()).model).toBe(`${base}@s1c23`);
  await picker.click();
  await list.getByRole("option", { name: "未附商家资料的型号", exact: true }).click();
  await expect.poll(async () => (await readNode()).model).toBe("gpt-image-2.5-flare");
  await picker.click();
  await panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }).press("Enter");
  await expect(picker).toContainText("未附商家资料的型号");
  expect((await readNode()).model).toBe("gpt-image-2.5-flare");
  expect(submitted).toBe(0);
});
