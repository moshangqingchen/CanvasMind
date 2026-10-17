import { expect, test } from "@playwright/test";
import { installAssistantFixture, assistantCanvasId, assistantModelKey } from "./helpers/assistant-fixture";
import { agentPanel, expectAgentModel } from "./helpers/agent-controls";

test("助手模型、模拟方案与参数编辑只读取已保存缓存，不扫描、不生成", async ({ page }) => {
  const fixture = await installAssistantFixture(page, { motion: false, channelParameters: true, unreadCatalog: true });
  const catalogReads: URL[] = [], supplierRefreshes: string[] = [], upstreamRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) upstreamRequests.push(url.origin);
    if (url.pathname === "/api/agent/models") catalogReads.push(url);
    if (/^\/api\/(?:suppliers\/[^/]+\/(?:scan|refresh)|providers\/[^/]+\/(?:scan|test))$/u.test(url.pathname) ||
      /\/models$/u.test(url.pathname) && (url.searchParams.get("fresh") === "1" || url.searchParams.get("refresh") === "1")) supplierRefreshes.push(url.pathname);
  });
  await page.goto(`/canvas/${assistantCanvasId}`);
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expectAgentModel(page, assistantModelKey);
  const panel = agentPanel(page);
  await panel.getByRole("button", { name: "对话模型", exact: true }).click();
  const popover = page.getByRole("dialog", { name: "选择对话模型", exact: true });
  await expect(popover).toContainText("来自已保存的供应商目录。");
  await expect(popover).not.toContainText("由当前供应商 API 实时返回");
  const unread = popover.getByLabel("未读取的供应商目录", { exact: true });
  await expect(unread).toContainText("纸月模型");
  await expect(unread).toContainText("未读取目录 · 请先在设置中刷新");
  await expect(unread).not.toContainText(/不支持|不可用/u);
  const before = fixture.modelReads();
  await popover.getByRole("button", { name: "重新读取缓存", exact: true }).click();
  await expect.poll(fixture.modelReads).toBe(before + 1);
  await page.keyboard.press("Escape");
  await panel.getByRole("textbox", { name: "创作任务要求", exact: true }).fill("请制作一张秋日活动海报，先给我待确认方案。");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(panel.getByTestId("agent-stream-output")).toBeVisible();
  await expect(panel.getByRole("button", { name: "放入画布", exact: true })).toBeEnabled();
  const card = panel.locator('article[class*="productionCard"]');
  await card.locator('details[class*="planStep"] > summary').click();
  const controls = card.getByRole("group", { name: "秋日主视觉 渠道与参数", exact: true });
  await expect(controls.getByLabel("未读取的供应商目录", { exact: true })).toContainText("未读取目录 · 请先在设置中刷新");
  await controls.getByLabel("秋日主视觉 供应商", { exact: true }).selectOption("fixture-image-b");
  await expect(controls.getByLabel("质量", { exact: true })).toHaveValue("standard");
  await controls.getByLabel("种子", { exact: true }).fill("77");
  await controls.getByRole("combobox", { name: "秋日主视觉 执行模型", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "秋日主视觉 执行模型 可选模型", exact: true })).toContainText("fixture.image.full-id-b");
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "保存方案修改", exact: true }).click();
  await expect(panel.getByRole("button", { name: "放入画布", exact: true })).toBeEnabled();
  expect(fixture.sessions.get("assistant-session-main")!.plans[0]!.proposal.calls[0]).toMatchObject({
    preferredConnectionId: "assistant-image-b", preferredModelId: "fixture.image.full-id-b", parameters: { quality: "standard", seed: 77 },
  });
  expect(catalogReads.length).toBeGreaterThanOrEqual(2);
  expect(catalogReads.every(url => url.searchParams.get("cached") === "1" && url.searchParams.get("includeConnections") === "1")).toBe(true);
  expect(supplierRefreshes).toEqual([]);
  expect(upstreamRequests).toEqual([]);
  expect(fixture.calls.map(call => call.action)).toEqual(["turn:auto", "update"]);
  expect(fixture.canvas.graph.nodes).toHaveLength(2);
  fixture.assertSafe();
});

test("未读取目录的图像连接可从助手与方案定位到对应供应商设置", async ({ page }) => {
  const fixture = await installAssistantFixture(page, { motion: false, channelParameters: true, unreadCatalog: true });
  await page.goto(`/canvas/${assistantCanvasId}`);
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expectAgentModel(page, assistantModelKey);
  const panel = agentPanel(page);
  await panel.getByRole("button", { name: "对话模型", exact: true }).click();
  await page.getByRole("dialog", { name: "选择对话模型", exact: true }).getByRole("button", { name: "前往 纸月模型连接 供应商设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  await expect(settings.getByRole("tab", { name: "供应商与模型", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("heading", { name: "纸月模型", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await panel.getByRole("textbox", { name: "创作任务要求", exact: true }).fill("请制作一张秋日活动海报，先给我待确认方案。");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(panel.getByRole("button", { name: "放入画布", exact: true })).toBeEnabled();
  const card = panel.locator('article[class*="productionCard"]');
  await card.locator('details[class*="planStep"] > summary').click();
  await card.getByRole("button", { name: "前往 纸月模型连接 供应商设置", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "纸月模型", exact: true })).toBeVisible();
  expect(fixture.calls.map(call => call.action)).toEqual(["turn:auto"]);
  fixture.assertSafe();
});
