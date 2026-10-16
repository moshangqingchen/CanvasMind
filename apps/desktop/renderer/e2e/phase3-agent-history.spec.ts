import { expect, test, type Page } from "@playwright/test";
import type { AgentSession } from "../lib/agent-contracts";
import type { AgentModelOption } from "../lib/agent-models";

const canvasId = "phase3-agent-history";
const now = "2026-10-14T00:00:00Z";
const model: AgentModelOption = {
  supplierId: "isolated-site", supplierName: "隔离站点", group: "界面夹具",
  connectionId: "isolated-model", connectionName: "隔离文本模型", modelId: "offline", modelName: "离线界面夹具",
  protocol: "openai-chat-completions", available: true, source: "manual",
  capabilities: { text: true, imageInput: false, audioInput: false, videoInput: false, structuredOutput: false, toolCalling: false, nativeWebSearch: false, reasoning: false },
};

async function fixture(page: Page, denied: boolean) {
  const errors: string[] = [];
  let submissions = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  const session: AgentSession = {
    id: "long-session", canvasId, title: "长对话界面夹具", plans: [],
    messages: Array.from({ length: 240 }, (_, index) => ({
      id: `message-${index}`, role: index % 2 ? "assistant" : "user", createdAt: now, metadata: {},
      content: index === 239 ? '最后一条消息 239\n\n```js\nconst answer = 42;\n```' : `消息 ${index}：${"这是保留的创作对话内容。".repeat(index % 5 + 2)}`,
    })),
  };
  if (denied) await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Storage denied", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await page.route("**/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (path === "/api/agent/turn" || path === "/api/runs")) { submissions++; return route.fulfill({ status: 400, json: { error: "This UI fixture never submits" } }); }
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{ id: canvasId, title: "智能体长对话", nodeCount: 0, createdAt: now, updatedAt: now }] } });
    if (path.startsWith("/api/canvas/")) return route.fulfill({ json: { id: canvasId, title: "智能体长对话", revision: 1, graph: { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } } });
    if (path === "/api/agent/models") return route.fulfill({ json: [model, { ...model, connectionId: "isolated-second", modelId: "second", modelName: "另一个隔离型号" }] });
    if (path === "/api/agent/sessions") return route.fulfill({ json: [{ id: session.id, title: session.title }] });
    if (path === `/api/agent/sessions/${session.id}`) return route.fulfill({ json: session });
    if (["/api/assets", "/api/providers", "/api/suppliers", "/api/runs", "/api/integrations/material-drops"].includes(path)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], messages: [], sessions: [], groups: [], drops: [] } });
  });
  await page.goto(`/canvas/${canvasId}`);
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  const panel = page.getByRole("region", { name: "通用创作智能体" });
  await expect(panel.getByLabel("创作任务", { exact: true })).toHaveValue(session.id);
  return { panel, errors, submissions: () => submissions };
}

test("240条智能体对话只挂窗口消息，自动定位末尾且缩放重测后保持底部", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { panel, errors, submissions } = await fixture(page, false);
  const conversation = panel.getByRole("list", { name: "智能体对话" });
  await expect(conversation.getByText("最后一条消息 239", { exact: true })).toBeVisible();
  expect(await conversation.getByRole("listitem").count()).toBeLessThan(20);
  await expect(conversation.locator("pre code")).toHaveText("const answer = 42;");
  expect(await conversation.locator("pre code").evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/mono|consolas/i);
  await conversation.evaluate(element => { element.scrollTop = 0; });
  await expect(conversation.getByText(/^消息 0：/)).toBeVisible();
  expect(await conversation.getByRole("listitem").count()).toBeLessThan(20);
  await conversation.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(conversation.getByText("最后一条消息 239", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(() => conversation.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(8);
  await expect(conversation.getByText("最后一条消息 239", { exact: true })).toBeVisible();
  const modelDetails = panel.locator("details").filter({ has: page.locator("summary").filter({ hasText: "对话模型" }) });
  await modelDetails.locator("summary").click();
  await expect(modelDetails).not.toHaveAttribute("open");
  const draft = panel.getByLabel("创作任务要求");
  await draft.fill("保留在悬浮输入区的创作草稿");
  const attach = panel.getByRole("button", { name: "添加参考素材", exact: true });
  const send = panel.getByRole("button", { name: "发送任务", exact: true });
  await send.scrollIntoViewIfNeeded();
  const panelBounds = (await panel.boundingBox())!;
  const attachBounds = (await attach.boundingBox())!;
  const sendBounds = (await send.boundingBox())!;
  expect(attachBounds.x).toBeLessThan(sendBounds.x);
  expect(sendBounds.x + sendBounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width);
  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height);
  // This fixture is text-only: attachment is deliberately disabled and cannot
  // take focus. Tab from the preceding enabled, collapsed model summary so
  // the real keyboard path skips attachment and reaches the send action.
  await expect(attach).toBeDisabled();
  const modelSummary = modelDetails.locator("summary");
  await modelSummary.focus();
  await expect(modelSummary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(send).toBeFocused();
  await expect.poll(() => send.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  await expect(send).toHaveCSS("outline-style", "solid");
  await panel.getByRole("button", { name: "关闭智能体", exact: true }).click();
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expect(modelDetails).not.toHaveAttribute("open");
  await expect(draft).toHaveValue("保留在悬浮输入区的创作草稿");
  await modelDetails.locator("summary").click();
  await expect(modelDetails).toHaveAttribute("open", "");
  expect(errors).toEqual([]);
  expect(submissions()).toBe(0);
});

test("界面偏好存储读写拒绝时智能体仍恢复会话和切换型号，不触发生成", async ({ page }) => {
  const { panel, errors, submissions } = await fixture(page, true);
  const picker = panel.getByLabel("智能体模型", { exact: true });
  await expect(picker).toBeVisible();
  // The fixture's second model uses a separate connection. Follow the visible
  // supplier/group/connection hierarchy before choosing that connection's model.
  const connection = panel.getByLabel("智能体分组连接", { exact: true });
  await connection.selectOption("isolated-second");
  await expect(connection).toHaveValue("isolated-second");
  await picker.selectOption("isolated-second\nsecond");
  await expect(picker).toHaveValue("isolated-second\nsecond");
  await panel.getByLabel("创作任务要求").fill("只填写草稿，不提交");
  await expect(panel.getByLabel("创作任务要求")).toHaveValue("只填写草稿，不提交");
  await expect(panel.getByLabel("创作任务", { exact: true })).toHaveValue("long-session");
  expect(errors).toEqual([]);
  expect(submissions()).toBe(0);
});
