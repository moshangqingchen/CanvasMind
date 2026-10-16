import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installAssistantFixture,
  assistantCanvasId,
  assistantMarkdown,
  assistantModelKey,
} from "./helpers/assistant-fixture";
import {
  agentPanel,
  agentModelTrigger,
  agentModelRow,
  agentSessionTrigger,
  openAgentModels,
  closeAgentModels,
  chooseAgentModel,
  expectAgentModel,
  openAgentSessions,
} from "./helpers/agent-controls";

const repository = fileURLToPath(new URL("../../../..", import.meta.url));
const output = resolve(
  repository,
  process.env.NEURAL_EVIDENCE_DIR ??
    ".codex-logs/2026-10-16-redesign/out/assistant",
);
async function capture(page: Page, name: string) {
  // Targeted video recaptures preserve the approved PNG set byte for byte.
  if (process.env.NEURAL_VIDEO_ONLY === "1") return;
  await mkdir(join(output, "screenshots"), { recursive: true });
  await page.screenshot({
    path: join(output, "screenshots", `${name}.png`),
    animations: "allow",
  });
}
async function captureRework(page: Page, name: string) {
  const directory = resolve(repository, ".codex-logs/2026-10-16-redesign/out/assistant/rework/after");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), animations: "allow" });
}
async function openAssistant(page: Page, selectNode = false) {
  await page.goto(`/canvas/${assistantCanvasId}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  if (selectNode)
    await page
      .locator('.react-flow__node[data-id="assistant-prompt"] .node-title')
      .click();
  if (!(await agentPanel(page).isVisible()))
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expectAgentModel(page, assistantModelKey);
  return agentPanel(page);
}
const materialize = (page: Page) =>
  agentPanel(page).getByRole("button", { name: /^(?:第一次确认：)?放入画布/u });
const preflight = (page: Page) =>
  agentPanel(page).getByRole("button", {
    name: /估算费用|我已检查节点，进行预检/u,
  });
const execute = (page: Page) =>
  agentPanel(page).getByRole("button", {
    name: /^(?:第二次确认：)?(?:开始生成|确认生成)/u,
  });

async function attachSavedReference(page: Page, id: string) {
  await agentPanel(page)
    .locator(".agent-composer")
    .evaluate((composer, id) => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-super-canvas-asset", id);
      composer.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    }, id);
  await expect(
    agentPanel(page).getByRole("button", {
      name: "移除 产品原始参考.png",
      exact: true,
    }),
  ).toBeVisible();
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme} 返工打磨：唯一能力行、药丸操作、顶部三步与完整元信息`, async ({ page }) => {
    const fixture = await installAssistantFixture(page, { theme, motion: false });
    const panel = await openAssistant(page);
    const dialog = await openAgentModels(page);
    const capability = dialog.getByLabel("模型参考素材支持", { exact: true });
    await expect(capability).toHaveCount(1);
    await expect(capability.locator("span")).toHaveCount(3);
    await expect(capability).toContainText("图片 ✓ 最多 4 张");
    await expect(capability).toContainText("视频 ✓ 最多 1 个");
    await expect(capability).toContainText("音频 ✓ 最多 2 个");
    await expect(dialog.getByText("思考档位来自供应商目录", { exact: true })).toHaveCount(1);
    await expect(dialog.getByText("供应商声明的思考档位", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("由已保存的供应商目录声明，未触发检测。", { exact: true })).toHaveCount(0);
    const detail = dialog.getByLabel("模型素材与思考详情", { exact: true });
    await expect(detail).not.toHaveAttribute("open");
    await captureRework(page, `${theme}-model-popover`);
    await detail.locator("summary").click();
    await expect(detail).toContainText("每轮最多 16 个附件，单个 16 MB，总计 24 MB");
    await expect(detail).toContainText("供应商每轮最多 6 个附件");
    expect(fixture.turns).toHaveLength(0);
    await closeAgentModels(page);

    await fixture.setMode("storyboard");
    const draft = panel.getByRole("textbox", { name: "创作任务要求", exact: true });
    await draft.fill("先整理一个六秒的产品分镜");
    await panel.getByRole("button", { name: "发送任务", exact: true }).click();
    await expect(panel.getByText("秋日产品分镜", { exact: true })).toBeVisible();
    const preview = panel.getByRole("button", { name: "预览放入画布方案", exact: true });
    await expect(preview).toHaveClass(/primary/u);
    for (const name of ["保存成果", "复制", "继续规划配图或视频"]) {
      const button = panel.getByRole("button", { name, exact: true });
      await expect(button).toHaveClass(/ghost/u);
      expect(await button.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      expect(await button.evaluate(element => getComputedStyle(element).borderRadius)).toBe("999px");
    }
    await captureRework(page, `${theme}-storyboard`);
    expect(fixture.calls.map(call => call.action)).toEqual(["turn:chat"]);

    await panel.getByRole("button", { name: "制作画布方案", exact: true }).click();
    await draft.fill("请按刚才的方向整理一张活动海报的画布方案");
    await panel.getByRole("button", { name: "发送任务", exact: true }).click();
    await expect(materialize(page)).toBeEnabled();
    const card = panel.locator('article[class*="productionCard"]');
    const progress = card.getByRole("list", { name: "方案进度", exact: true });
    await expect(card.locator('h4 + ol[aria-label="方案进度"]')).toHaveCount(1);
    await expect(progress.locator('[aria-current="step"]')).toHaveText("① 检查方案");
    await expect(progress.getByRole("listitem")).toHaveCount(3);
    const meta = card.locator('summary [class*="stepMeta"]');
    await expect(meta).toHaveText("依赖：无 · 推荐模型：—");
    expect(await meta.evaluate(element => getComputedStyle(element).whiteSpace)).toBe("normal");
    expect(await meta.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(card.getByRole("button", { name: "检查方案与模型", exact: true })).toHaveClass(/ghost/u);
    await expect(card.getByRole("button", { name: "取消方案", exact: true })).toHaveClass(/dangerText/u);
    expect(fixture.calls.map(call => call.action)).toEqual(["turn:chat", "turn:canvas-plan"]);
    await captureRework(page, `${theme}-plan-step-1`);

    await materialize(page).click();
    await expect(preflight(page)).toBeEnabled();
    await expect(progress.locator('[aria-current="step"]')).toHaveText("② 放入画布");
    expect(fixture.calls.map(call => call.action)).toEqual(["turn:chat", "turn:canvas-plan", "materialize"]);
    await captureRework(page, `${theme}-plan-step-2`);

    await preflight(page).click();
    await expect(execute(page)).toBeDisabled();
    await expect(progress.locator('[aria-current="step"]')).toHaveText("③ 估算费用并开始生成");
    await expect(card.getByRole("button", { name: "重新估算费用", exact: true })).toHaveClass(/ghost/u);
    await expect(execute(page)).toHaveClass(/primary/u);
    expect(fixture.calls.map(call => call.action)).toEqual(["turn:chat", "turn:canvas-plan", "materialize", "preflight"]);
    await captureRework(page, `${theme}-plan-step-3`);
    await panel.getByRole("checkbox", { name: "我已了解价格未知，确认生成", exact: true }).check();
    await expect(execute(page)).toBeEnabled();
    await execute(page).click();
    await expect.poll(() => fixture.calls.map(call => call.action)).toEqual(["turn:chat", "turn:canvas-plan", "materialize", "preflight", "execute"]);
    expect(fixture.turns).toHaveLength(2);
    expect(fixture.turns[1]!.intent).toBe("canvas-plan");
    fixture.assertSafe();
  });

  test(`${theme} 欢迎光核、节点与素材上下文真实，建议只填写草稿`, async ({
    page,
  }) => {
    const fixture = await installAssistantFixture(page, {
      theme,
      motion: false,
    });
    const panel = await openAssistant(page, true);
    const railCore = page
      .getByRole("button", { name: "打开智能体", exact: true })
      .locator("i[data-state]");
    await expect(railCore).toBeVisible();
    await expect(railCore).toBeInViewport({ ratio: 1 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      panel.getByRole("heading", { name: "有什么想法，聊聊吧。", exact: true }),
    ).toBeVisible();
    const core = panel.locator('[data-state][style*="72px"]');
    await expect(core).toBeVisible();
    const coreBox = (await core.boundingBox())!;
    expect(coreBox.width).toBe(72);
    expect(coreBox.height).toBe(72);
    await expect(panel.getByLabel("助手能看到")).toContainText(
      "当前画布 · 2 个节点",
    );
    await expect(panel.getByLabel("助手能看到")).toContainText("已选 1 个节点");
    await capture(page, `${theme}-welcome`);
    await panel
      .getByRole("button", { name: "一起聊聊这次创作的方向", exact: true })
      .click();
    await expect(
      panel.getByRole("textbox", { name: "创作任务要求", exact: true }),
    ).toHaveValue("一起聊聊这次创作的方向");
    await panel.locator('input[type="file"]').setInputFiles({
      name: "产品原始参考.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
    await expect(panel.getByLabel("助手能看到")).toContainText("已附 1 个素材");
    await expect(
      panel.getByRole("button", { name: "移除 产品原始参考.png", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "发送任务", exact: true }),
    ).toBeEnabled();
    expect(fixture.turns).toEqual([]);
    expect(fixture.calls).toEqual([]);
    fixture.assertSafe();
  });

  test(`${theme} 型号与会话浮层搜索、键盘、真实能力和窄屏`, async ({
    page,
  }) => {
    const fixture = await installAssistantFixture(page, {
      theme,
      motion: false,
    });
    const panel = await openAssistant(page);
    const draft = panel.getByRole("textbox", {
      name: "创作任务要求",
      exact: true,
    });
    await draft.fill("模型切换时保留的未发送草稿");
    let dialog = await openAgentModels(page);
    await expect(dialog.locator("details[data-supplier-id]")).toHaveCount(2);
    const primary = dialog.locator(
      '[data-supplier-id="assistant-supplier-a"] [data-model-group="文字创作组"] [data-connection-id="assistant-primary"]',
    );
    await expect(agentModelRow(primary, assistantModelKey)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(dialog.getByLabel("完整模型 ID", { exact: true })).toHaveText(
      "fixture.chat.2026-10-full-id",
    );
    const capabilities = dialog.getByLabel("模型参考素材支持", { exact: true });
    await expect(capabilities).toContainText("图片 ✓ 最多 4 张");
    await expect(capabilities).toContainText("视频 ✓ 最多 1 个");
    await expect(capabilities).toContainText("音频 ✓ 最多 2 个");
    expect(
      await capabilities.evaluate(
        (element) => getComputedStyle(element).textOverflow,
      ),
    ).not.toBe("ellipsis");
    await dialog
      .getByRole("group", { name: "思考强度", exact: true })
      .getByRole("button", { name: "高", exact: true })
      .click();
    await expect(dialog.locator('[data-reasoning="high"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      dialog.getByRole("button", { name: "刷新模型列表", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "管理供应商与模型", exact: true }),
    ).toBeInViewport();
    await capture(page, `${theme}-model-popover`);
    const reads = fixture.modelReads();
    await dialog
      .getByRole("button", { name: "刷新模型列表", exact: true })
      .click();
    await expect.poll(fixture.modelReads).toBe(reads + 1);
    await dialog
      .getByRole("searchbox", { name: "搜索对话模型", exact: true })
      .fill("fixture.chat.text-only-v2");
    await page.keyboard.press("ArrowDown");
    await expect(
      agentModelRow(dialog, "assistant-secondary\nfixture.chat.text-only-v2"),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expectAgentModel(
      page,
      "assistant-secondary\nfixture.chat.text-only-v2",
    );
    await closeAgentModels(page);
    await expect(draft).toHaveValue("模型切换时保留的未发送草稿");
    await chooseAgentModel(page, assistantModelKey);
    dialog = await openAgentModels(page);
    await expect(dialog.locator('[data-reasoning="auto"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(agentModelTrigger(page)).toBeFocused();
    let sessions = await openAgentSessions(page);
    await expect(
      sessions.getByRole("button", { name: /旧对话（只读）/u }),
    ).toBeInViewport();
    await capture(page, `${theme}-session-popover`);
    await sessions
      .getByRole("searchbox", { name: "搜索对话", exact: true })
      .fill("月光");
    await expect(
      sessions.locator('button[data-session-id="assistant-session-main"]'),
    ).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(agentSessionTrigger(page)).toHaveAttribute(
      "data-session-id",
      "assistant-session-previous",
    );
    await expect(
      panel.getByText("上一段对话保留的品牌讨论。", { exact: true }),
    ).toBeVisible();
    sessions = await openAgentSessions(page);
    await sessions
      .getByRole("button", { name: "旧对话（只读）", exact: true })
      .click();
    await expect(
      panel.getByText("仅保留的本地旧对话", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("仅保留的项目旧对话", { exact: true }),
    ).toBeVisible();
    expect(fixture.calls).toEqual([]);
    await panel
      .getByRole("button", { name: "返回当前任务", exact: true })
      .click();
    sessions = await openAgentSessions(page);
    await sessions.getByRole("button", { name: "新对话", exact: true }).click();
    await expect(agentSessionTrigger(page)).toHaveAttribute(
      "data-session-id",
      /^assistant-session-new-/u,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    dialog = await openAgentModels(page);
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await capture(page, `${theme}-model-popover-narrow`);
    await closeAgentModels(page);
    sessions = await openAgentSessions(page);
    await expect(sessions).toBeInViewport({ ratio: 1 });
    await capture(page, `${theme}-session-popover-narrow`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(fixture.turns).toEqual([]);
    fixture.assertSafe();
  });
}

test("流式正文逐块出现、工具合并思考过程、安全 Markdown 保留结构", async ({
  page,
}) => {
  const fixture = await installAssistantFixture(page, {
    motion: false,
    markdownProbe: true,
  });
  const panel = await openAssistant(page);
  await panel
    .getByRole("textbox", { name: "创作任务要求", exact: true })
    .fill("聊聊‘生成海报’的方向，先讨论，不制作。");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  const stream = panel.getByTestId("agent-stream-output");
  await expect(stream).toContainText("秋日视觉方向");
  await expect(
    panel.getByRole("button", { name: "停止分析", exact: true }),
  ).toBeVisible();
  await expect(stream.locator('[class*="streamCursor"]')).toBeVisible();
  const thinking = panel
    .locator("summary")
    .filter({ hasText: "思考过程 · 2 步" });
  await expect(thinking).toHaveCount(1);
  await thinking.click();
  await expect(thinking.locator("..").getByRole("listitem")).toHaveCount(2);
  await capture(page, "dark-stream-thinking");
  await expect(
    panel.getByRole("button", { name: "停止分析", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByRole("table")).toContainText("月光银");
  await expect(panel.locator("blockquote")).toContainText(
    "先把品牌的温度说清楚",
  );
  await expect(panel.locator("pre code")).toContainText("const palette");
  await expect(panel.locator("ul")).toContainText("保留真实素材");
  expect(
    [...fixture.sessions.values()]
      .flatMap((session) => session.messages)
      .some((message) => message.content === assistantMarkdown),
  ).toBe(true);
  await expect(panel).toContainText("<img src=x onerror=");
  await expect(panel).toContainText("<script>window.");
  await expect(panel.locator('script,img[src="x"],[onerror]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __assistantUnsafe?: boolean }).__assistantUnsafe,
    ),
  ).toBeUndefined();
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.turns[0]!.intent).toBe("chat");
  expect(
    [...fixture.sessions.values()].flatMap((session) => session.plans),
  ).toEqual([]);
  expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
  fixture.assertSafe();
});

test("停止逐块流式回复会中断读取，保留文本且不自动重发", async ({ page }) => {
  const fixture = await installAssistantFixture(page, { motion: false });
  const panel = await openAssistant(page);
  await fixture.setMode("slow");
  await panel
    .getByRole("textbox", { name: "创作任务要求", exact: true })
    .fill("逐步整理品牌方向");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  const stream = panel.getByTestId("agent-stream-output");
  await expect(stream).toContainText("逐步整理第1段");
  await panel.getByRole("button", { name: "停止分析", exact: true }).click();
  await expect.poll(() => fixture.cancelled.length).toBe(1);
  await expect(stream).toHaveAttribute("data-interrupted", "true");
  await expect(stream).toContainText("未自动重发");
  await expect(stream.locator('[class*="streamCursor"]')).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "停止分析", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "发送任务", exact: true }),
  ).toBeVisible();
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
  fixture.assertSafe();
});

test("流式连接提前结束但同请求已持久化时只恢复一条最终回复", async ({
  page,
}) => {
  const fixture = await installAssistantFixture(page, { motion: false });
  const panel = await openAssistant(page);
  await fixture.setMode("durable-disconnect");
  const draft = panel.getByRole("textbox", {
    name: "创作任务要求",
    exact: true,
  });
  await draft.fill("连接断开时先查看同一个请求，不自动重发");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(panel.getByTestId("agent-stream-output")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "停止分析", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByText("断流后的完整回复已保存，只显示一次。", { exact: true }),
  ).toHaveCount(1);
  await expect(panel.getByTestId("agent-stream-output")).toHaveCount(0);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(draft).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "聊天", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
  fixture.assertSafe();
});

test("多题澄清选项逐题填入草稿，不自动发送或创建方案", async ({ page }) => {
  const fixture = await installAssistantFixture(page, { motion: false });
  const panel = await openAssistant(page);
  await fixture.setMode("clarify");
  const draft = panel.getByRole("textbox", {
    name: "创作任务要求",
    exact: true,
  });
  await draft.fill("一起确认这次设计的方向");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "安静克制", exact: true }),
  ).toBeVisible();
  await capture(page, "dark-clarify");
  await panel.getByRole("button", { name: "安静克制", exact: true }).click();
  await expect(draft).toHaveValue(/安静克制/u);
  await panel.getByRole("button", { name: "活动海报", exact: true }).click();
  await expect(draft).toHaveValue(/安静克制/u);
  await expect(draft).toHaveValue(/活动海报/u);
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
  fixture.assertSafe();
});

test("分镜镜头卡保留编辑和选择，继续规划只填草稿", async ({ page }) => {
  const fixture = await installAssistantFixture(page, { motion: false });
  const panel = await openAssistant(page);
  await fixture.setMode("storyboard");
  await panel
    .getByRole("textbox", { name: "创作任务要求", exact: true })
    .fill("先整理一个六秒的产品分镜");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(panel.getByText("秋日产品分镜", { exact: true })).toBeVisible();
  await capture(page, "dark-storyboard");
  await panel.getByRole("checkbox", { name: /镜头1/u }).uncheck();
  const shot = panel.locator("summary").filter({
    has: page.getByRole("checkbox", { name: "选择镜头 镜头2", exact: true }),
  });
  await expect(shot).toContainText("镜头2 · 3–6s");
  await expect(shot).toContainText("缓慢拉远");
  await shot.locator("strong").click();
  await panel
    .getByRole("textbox", { name: "镜头2 镜头提示词", exact: true })
    .fill("保留真实产品，慢慢拉远并留出字区。");
  await panel
    .getByRole("button", { name: "继续规划配图或视频", exact: true })
    .click();
  await expect(
    panel.getByRole("textbox", { name: "创作任务要求", exact: true }),
  ).toHaveValue(/慢慢拉远并留出字区/u);
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
  fixture.assertSafe();
});

test("方案编辑先保存、取消可撤回，均不隐式放入或执行", async ({ page }) => {
  const fixture = await installAssistantFixture(page, {
    motion: false,
    populated: true,
  });
  const panel = await openAssistant(page);
  await panel
    .getByRole("button", { name: "把这个做成画布方案", exact: true })
    .click();
  await expect(materialize(page)).toBeEnabled();
  const prompt = panel.getByRole("textbox", {
    name: "秋日主视觉 提示词",
    exact: true,
  });
  const step = panel.locator("details").filter({
    has: page.getByLabel("秋日主视觉 提示词", {
      exact: true,
    }),
  });
  await step.locator(":scope > summary").click();
  await prompt.fill("保留用户原始产品，调整为更安静的留白构图。");
  await expect(materialize(page)).toBeDisabled();
  expect(fixture.calls.map((call) => call.action)).toEqual([
    "turn:canvas-plan",
  ]);
  await panel
    .getByRole("button", { name: "保存方案修改", exact: true })
    .click();
  await expect(materialize(page)).toBeEnabled();
  expect(fixture.calls.map((call) => call.action)).toEqual([
    "turn:canvas-plan",
    "update",
  ]);
  expect(
    fixture.sessions.get("assistant-session-main")!.plans[0]!.proposal.calls[0]!
      .prompt,
  ).toContain("更安静的留白构图");
  await panel.getByRole("button", { name: "取消方案", exact: true }).click();
  await expect(materialize(page)).toHaveCount(0);
  expect(fixture.calls.map((call) => call.action)).toEqual([
    "turn:canvas-plan",
    "update",
    "cancel",
  ]);
  fixture.assertSafe();
});

test("助手宽度360–640可键盘调整并保存，减少动态效果与390窗口稳定", async ({
  page,
}) => {
  const fixture = await installAssistantFixture(page, { motion: false });
  const panel = await openAssistant(page);
  const handle = page.getByRole("separator", {
    name: "调整右侧面板宽度",
    exact: true,
  });
  await expect(handle).toHaveAttribute("aria-valuemin", "360");
  await expect(handle).toHaveAttribute("aria-valuemax", "640");
  for (let i = 0; i < 20; i++) await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "640");
  await page.reload();
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "640");
  for (let i = 0; i < 20; i++) await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  await expect
    .poll(() =>
      panel
        .locator("[data-state]")
        .evaluateAll((elements) =>
          elements.every(
            (element) => getComputedStyle(element).animationName === "none",
          ),
        ),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeInViewport({ ratio: 1 });
  const input = panel.getByRole("textbox", {
    name: "创作任务要求",
    exact: true,
  });
  const emptyHeight = (await input.boundingBox())!.height;
  await input.fill(
    Array.from({ length: 5 }, (_, index) => `第 ${index + 1} 行创作要求`).join(
      "\n",
    ),
  );
  await expect
    .poll(async () => (await input.boundingBox())!.height)
    .toBeGreaterThan(emptyHeight);
  await expect
    .poll(async () => (await input.boundingBox())!.height)
    .toBeLessThanOrEqual(176);
  await expect(
    panel.getByRole("button", { name: "发送任务", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(input).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await capture(page, "dark-narrow-reduced");
  fixture.assertSafe();
});

test("同轮聊天附件清空后转换只携带该轮参考，不混入历史素材", async ({
  page,
}) => {
  const fixture = await installAssistantFixture(page, { motion: false });
  const referenceId = "assistant-reference-image";
  const historicalReferenceId = "assistant-older-reference";
  fixture.assets.push({
    ...fixture.assets[0]!,
    id: historicalReferenceId,
    name: "上轮无关参考.png",
  });
  fixture.sessions.get("assistant-session-main")!.messages.push(
    {
      id: "older-user",
      role: "user",
      content: "上轮无关任务：研究另一件产品。",
      createdAt: "2026-10-15T09:00:00.000Z",
      metadata: {
        kind: "message",
        requestId: "older-request",
        attachmentAssetIds: [historicalReferenceId],
      },
    },
    {
      id: "older-assistant",
      role: "assistant",
      content: "上一轮讨论已结束。",
      createdAt: "2026-10-15T09:00:00.000Z",
      metadata: { kind: "message", requestId: "older-request" },
    },
  );
  const panel = await openAssistant(page);
  await attachSavedReference(page, referenceId);
  await panel
    .getByRole("textbox", { name: "创作任务要求", exact: true })
    .fill("只讨论本轮产品原图的视觉方向，先不要制作方案。");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  const convert = panel.getByRole("button", {
    name: "把这个做成画布方案",
    exact: true,
  });
  await expect(convert).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "移除 产品原始参考.png", exact: true }),
  ).toHaveCount(0);
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.turns[0]).toMatchObject({
    intent: "chat",
    attachmentAssetIds: [referenceId],
  });
  expect(
    [...fixture.sessions.values()].flatMap((session) => session.plans),
  ).toEqual([]);
  expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
  await convert.click();
  await expect(materialize(page)).toBeEnabled();
  expect(fixture.turns).toHaveLength(2);
  expect(fixture.turns[1]).toMatchObject({
    intent: "canvas-plan",
    sessionId: fixture.turns[0]!.sessionId,
    attachmentAssetIds: [referenceId],
  });
  expect(fixture.turns[1]!.attachmentAssetIds).not.toContain(
    historicalReferenceId,
  );
  expect(fixture.turns[1]!.message).toContain("只讨论本轮产品原图的视觉方向");
  expect(fixture.turns[1]!.message).not.toContain("上轮无关任务");
  expect(fixture.calls.map((call) => call.action)).toEqual([
    "turn:chat",
    "turn:canvas-plan",
  ]);
  fixture.assertSafe();
});

test("讨论引用已删除时转换显示错误，不提交新请求或创建方案", async ({
  page,
}) => {
  const fixture = await installAssistantFixture(page, { motion: false });
  let panel = await openAssistant(page);
  await attachSavedReference(page, "assistant-reference-image");
  await panel
    .getByRole("textbox", { name: "创作任务要求", exact: true })
    .fill("讨论这张产品原图，先不制作。");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "把这个做成画布方案", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "移除 产品原始参考.png", exact: true }),
  ).toHaveCount(0);
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.turns[0]!.attachmentAssetIds).toEqual([
    "assistant-reference-image",
  ]);
  fixture.assets.splice(0);
  // Reload the real catalog cache after the reference was deleted elsewhere.
  panel = await openAssistant(page);
  const readsBeforeClick = fixture.assetReads();
  await panel
    .getByRole("button", { name: "把这个做成画布方案", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("部分参考素材已不存在");
  await expect.poll(fixture.assetReads).toBe(readsBeforeClick + 1);
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
  expect(
    [...fixture.sessions.values()].flatMap((session) => session.plans),
  ).toEqual([]);
  await expect(materialize(page)).toHaveCount(0);
  fixture.assertSafe();
});

test("首页草稿→模拟流式回复→手动转换方案→三次明确动作完整录屏", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: String(info.project.use.baseURL),
    extraHTTPHeaders: {
      "x-supercanvas-desktop-token": "supercanvas-isolated-e2e-session",
    },
    recordVideo: {
      dir: join(output, "video-raw"),
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage(),
    video = page.video();
  const fixture = await installAssistantFixture(page, {
    motion: true,
    chatStreamDurationMs: 3200,
  });
  try {
    await page.goto("/");
    await expect(page.getByTestId("neural-workspace")).toBeVisible();
    const search = page.getByRole("combobox", {
      name: "搜索创作空间",
      exact: true,
    });
    await search.fill("我们先聊一聊秋日品牌的方向");
    // Reading holds are for this recorded demonstration, after real state checks.
    await expect(search).toHaveValue("我们先聊一聊秋日品牌的方向");
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /交给创作助手/u }).click();
    const panel = agentPanel(page),
      draft = panel.getByRole("textbox", { name: "创作任务要求", exact: true });
    await expect(draft).toHaveValue("我们先聊一聊秋日品牌的方向");
    await expect(draft).toBeFocused();
    expect(fixture.turns).toHaveLength(0);
    await expect
      .poll(() => agentModelTrigger(page).getAttribute("data-model-key"))
      .toBe(assistantModelKey);
    await page.waitForTimeout(1200);
    expect(fixture.turns).toHaveLength(0);
    await panel.getByRole("button", { name: "发送任务", exact: true }).click();
    const stream = panel.getByTestId("agent-stream-output");
    await expect(stream).toContainText("秋日视觉方向");
    await capture(page, "flow-stream");
    await page.waitForTimeout(2500);
    await expect(stream).toBeVisible();
    const convert = panel.getByRole("button", {
      name: "把这个做成画布方案",
      exact: true,
    });
    await expect(convert).toBeEnabled();
    expect(fixture.calls.map((call) => call.action)).toEqual(["turn:chat"]);
    await page.waitForTimeout(1000);
    await convert.click();
    await expect(materialize(page)).toBeEnabled();
    expect(fixture.turns).toHaveLength(2);
    expect(fixture.turns[1]).toMatchObject({
      intent: "canvas-plan",
      sessionId: fixture.turns[0]!.sessionId,
    });
    expect(fixture.turns[1]!.message).toContain("我们先聊一聊秋日品牌的方向");
    expect(fixture.calls.map((call) => call.action)).toEqual([
      "turn:chat",
      "turn:canvas-plan",
    ]);
    await capture(page, "dark-plan-step-1");
    await page.waitForTimeout(2000);
    await materialize(page).click();
    await expect(preflight(page)).toBeEnabled();
    expect(fixture.calls.map((call) => call.action)).toEqual([
      "turn:chat",
      "turn:canvas-plan",
      "materialize",
    ]);
    await capture(page, "dark-plan-step-2");
    await page.waitForTimeout(1500);
    await preflight(page).click();
    await expect(execute(page)).toBeDisabled();
    await capture(page, "dark-plan-step-3");
    expect(fixture.calls.map((call) => call.action)).toEqual([
      "turn:chat",
      "turn:canvas-plan",
      "materialize",
      "preflight",
    ]);
    await page.waitForTimeout(1500);
    await panel
      .getByRole("checkbox", {
        name: "我已了解价格未知，确认生成",
        exact: true,
      })
      .check();
    await expect(execute(page)).toBeEnabled();
    await page.waitForTimeout(1000);
    await execute(page).click();
    await expect
      .poll(() => fixture.calls.map((call) => call.action))
      .toEqual([
        "turn:chat",
        "turn:canvas-plan",
        "materialize",
        "preflight",
        "execute",
      ]);
    await expect(
      panel.getByText("已完成", { exact: true }).first(),
    ).toBeVisible();
    await page.waitForTimeout(1000);
    fixture.assertSafe();
  } finally {
    await context.close();
    if (video) await video.saveAs(join(output, "assistant-flow.webm"));
  }
});
