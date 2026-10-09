import { expect, test, type Page } from "@playwright/test";
import { parseTk1688Marketplace } from "@super-canvas/providers";
import type { AgentModelOption } from "../lib/agent-models";

const canvasId = "tk1688-agent-display";
const connectionId = "tk1688-agent-key";
const base = "gpt-6-sol";
const otherBase = "gpt-6-astra";
const savedAlias = `${base}@s47c261`;
const rows = [base, otherBase].flatMap((model, index) => [47, 48, 49].map(merchant => ({
  id: index * 10 + merchant,
  base_model: model,
  alias: `${model}@s${merchant}c${merchant + 214}`,
  supplier_id: merchant,
  channel_no: `ID00${merchant + 214}`,
  charge_type: "per_token",
  input_price_usd: merchant === 47 ? 0.9 : 1.2,
  output_price_usd: merchant === 47 ? 5 : 6,
  description: `商家 ${merchant} 声明的文本服务`,
  status: "active",
  channel_alive: true,
  modalities: ["text"],
})));
const descriptors = parseTk1688Marketplace({ success: true, data: { total: rows.length, items: rows } },
  { success: true, data: { payment_fx_rate_cny_per_usd: 6.8896 } }, { checkedAt: "2026-10-04T00:00:00.000Z",
    keyModelIds: [base, otherBase], accountModelIds: rows.map(row => row.alias) }).models;
const options: AgentModelOption[] = descriptors.map(model => ({
  supplierId: "tk1688", supplierName: "词元", supplierKey: "tk1688", group: "文本组",
  connectionId, connectionName: "词元文本组", modelId: model.id, modelName: model.name,
  description: model.description, metadata: model.metadata, pricing: model.pricing,
  protocol: "openai-chat-completions", available: true, source: "key",
  capabilities: { text: true, imageInput: false, audioInput: false, videoInput: false,
    structuredOutput: false, toolCalling: false, nativeWebSearch: false, reasoning: false },
}));

/** Mock every API call; selecting and refreshing cannot invoke a paid provider. */
async function scenario(page: Page, saved: string, initial = options, supplierKey = "tk1688") {
  const state = { models: [...initial], paidCalls: 0 };
  await page.addInitScript(({ canvasId, connectionId, saved }) => {
    const storageKey = `agent-model:${canvasId}`;
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, `${connectionId}\n${saved}`);
  }, { canvasId, connectionId, saved });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && ["/api/agent/turn", "/api/runs"].includes(path)) {
      state.paidCalls++;
      return route.abort();
    }
    if (path === "/api/agent/models") return route.fulfill({ json: state.models });
    if (path === `/api/canvas/${canvasId}`) return route.fulfill({ json: {
      id: canvasId, title: "词元文本选择验收", revision: 1,
      graph: { schemaVersion: 1, nodes: [], edges: [], drawings: [], viewport: { x: 0, y: 0, zoom: 1 } },
    } });
    if (path === "/api/providers") return route.fulfill({ json: [{
      id: connectionId, name: "词元文本组", provider: "openai", apiKeySet: true, apiKeyUsable: true,
      config: { supplierId: "tk1688", supplierKey, supplierName: "词元", modelGroup: "文本组",
        usage: "agent", baseUrl: "https://api.tk1688.com/v1" },
    }] });
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{
      id: canvasId, title: "词元文本选择验收", nodeCount: 0,
      createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z",
    }] } });
    if (path === "/api/agent/sessions" && supplierKey === "custom-tk1688") {
      // Let the model directory arrive first to exercise saved-selection restoration.
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ json: [] });
    }
    if (path.includes("/models") || path === "/api/assets" || path === "/api/runs" || path === "/api/agent/sessions")
      return route.fulfill({ json: [] });
    if (path.endsWith("/chat")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ json: { groups: [], items: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${canvasId}`);
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expect(page.getByRole("region", { name: "通用创作智能体" })
    .getByRole("button", { name: "聊天", exact: true })).toHaveAttribute("aria-pressed", "true");
  return state;
}

test("词元文本型号去重、保留已保存商家，用户选路后显示该商家报价与原始 ID", async ({ page }) => {
  const state = await scenario(page, savedAlias);
  const family = page.getByLabel("智能体模型", { exact: true });
  const route = page.getByLabel("智能体模型线路", { exact: true });
  await expect(family).toHaveValue(base);
  await expect(family.locator("option")).toHaveCount(2);
  await expect(route).toHaveValue(savedAlias);
  await expect(route.locator("option")).toHaveText([
    "自动路由", "商家 47 · 渠道 261", "商家 48 · 渠道 262", "商家 49 · 渠道 263",
  ]);
  await expect(page.getByLabel("智能体模型报价")).toContainText("输入 ¥6.20064/1M · 输出 ¥34.448/1M");
  await expect(page.getByLabel("智能体模型报价")).not.toContainText(/USD|\$/u);
  await expect(page.getByText("商家 47 声明的文本服务", { exact: false })).toBeVisible();
  const newAlias = `${base}@s48c262`;
  await route.selectOption(newAlias);
  await expect(page.getByLabel("智能体模型报价")).toContainText("输入 ¥8.26752/1M · 输出 ¥41.3376/1M");
  await expect(page.getByLabel("智能体模型报价")).not.toContainText(/USD|\$/u);
  await page.getByText("完整模型 ID", { exact: true }).click();
  await expect(page.locator("code").filter({ hasText: newAlias })).toBeVisible();
  await expect.poll(() => page.evaluate(canvas => localStorage.getItem(`agent-model:${canvas}`), canvasId))
    .toBe(`${connectionId}\n${newAlias}`);
  await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
  await expect(route).toHaveValue(newAlias);
  await page.reload();
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expect(route).toHaveValue(newAlias);
  await family.selectOption(otherBase);
  await expect(route).toHaveValue(otherBase);
  expect(state.paidCalls).toBe(0);
});

test("词元目录刷新移除当前商家时仍显示精确线路并停止可用状态", async ({ page }) => {
  const state = await scenario(page, savedAlias);
  const route = page.getByLabel("智能体模型线路", { exact: true });
  await expect(route).toHaveValue(savedAlias);
  state.models = state.models.filter(model => model.modelId !== savedAlias);
  await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
  await expect(route).toHaveValue(savedAlias);
  await expect(route.locator(`option[value="${savedAlias}"]`)).toContainText("本次目录未返回已保存线路");
  expect(await page.evaluate(canvas => localStorage.getItem(`agent-model:${canvas}`), canvasId))
    .toBe(`${connectionId}\n${savedAlias}`);
  expect(state.paidCalls).toBe(0);
});

test("词元旧保存线路缺失 descriptor 仍可见且不会被目录首项替换", async ({ page }) => {
  const oldAlias = `${base}@s99c999`;
  const ordinary: AgentModelOption = { ...options[0]!, supplierId: "ordinary", supplierName: "其他站点", supplierKey: "ordinary",
    connectionId: "ordinary-key", modelId: "ordinary-model", modelName: "普通型号", metadata: undefined };
  const state = await scenario(page, oldAlias, [ordinary, ...options], "custom-tk1688");
  await expect(page.getByLabel("智能体模型", { exact: true })).toHaveValue(oldAlias);
  await expect(page.getByLabel("智能体模型线路", { exact: true })).toHaveValue(oldAlias);
  await expect(page.getByLabel("智能体模型报价")).toContainText("暂未公布");
  await page.getByText("完整模型 ID", { exact: true }).click();
  await expect(page.locator("code").filter({ hasText: oldAlias })).toBeVisible();
  await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
  expect(await page.evaluate(canvas => localStorage.getItem(`agent-model:${canvas}`), canvasId))
    .toBe(`${connectionId}\n${oldAlias}`);
  expect(state.paidCalls).toBe(0);
});
