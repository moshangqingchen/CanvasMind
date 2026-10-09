import { expect, test, type Page } from "@playwright/test";
import type { AgentPlan, AgentSession, AgentTurnInput } from "../lib/agent-contracts";
import type { AgentModelOption } from "../lib/agent-models";

/** Browser APIs and external requests are intercepted; no model or user data is used. */
async function studioFixture(page: Page, startEmpty = false) {
  const canvasId = "studio-chat-fixture";
  const now = new Date().toISOString();
  const canvas = {
    id: canvasId, title: "创作对话", revision: 1,
    graph: { schemaVersion: 1, nodes: [], edges: [], drawings: [], viewport: { x: 0, y: 0, zoom: 0.7 } },
  };
  const session: AgentSession = { id: "studio-session", canvasId, title: "创作对话", messages: [], plans: [] };
  const model: AgentModelOption = {
    supplierId: "studio-supplier", supplierName: "对话测试供应商", group: "创作组",
    connectionId: "studio-connection", connectionName: "对话连接", modelId: "studio-chat", modelName: "对话模型 A",
    protocol: "openai-chat-completions", source: "manual", available: true,
    capabilities: { text: true, imageInput: true, audioInput: false, videoInput: false, structuredOutput: false,
      toolCalling: false, nativeWebSearch: false, reasoning: false },
    reasoningOptions: [{ value: "auto", label: "自动" }], inputLimits: { maxImages: 2 },
  };
  const plan: AgentPlan = {
    id: "studio-plan", sessionId: session.id, canvasId, version: 1, status: "awaiting_approval",
    summary: "产品主视觉方案", baseCanvasRevision: 1, calls: [],
    proposal: { type: "proposal", summary: "产品主视觉方案", assumptions: [], texts: [],
      calls: [{ id: "hero", label: "产品主视觉", prompt: "白色产品，柔和背景", requirements: { operation: "image.generate", count: 1 },
        sourceAssetIds: [], recommendation: "待确认生成方案" }] },
    patch: { nodes: [], edges: [], generationNodeIds: ["studio-image"], touchedExistingNodeIds: [] },
  };
  const turns: AgentTurnInput[] = [];
  const createdTitles: string[] = [];
  const project = { id: canvasId, title: canvas.title, createdAt: now, updatedAt: now, nodeCount: 0 };
  const projects = startEmpty ? [] : [project];
  let sessionCreated = false;
  let productionRequests = 0;
  let externalRequests = 0;
  const pageErrors: string[] = [];
  const unhandledApiRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const state = window as Window & { studioUiErrors?: string[] };
    state.studioUiErrors = [];
    // Remember transient errors as well as errors still visible at an assertion.
    new MutationObserver(() => {
      for (const element of document.querySelectorAll('.toast-error, .agent-panel > [role="alert"]')) {
        const message = element.textContent?.trim();
        if (message && !state.studioUiErrors!.includes(message)) state.studioUiErrors!.push(message);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) return route.continue();
    externalRequests++;
    return route.abort("blockedbyclient");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/projects") {
      if (request.method() === "POST") {
        createdTitles.push(request.postDataJSON().title);
        const createdProject = { ...project, title: request.postDataJSON().title };
        projects.push(createdProject);
        return route.fulfill({ json: { project: createdProject } });
      }
      return route.fulfill({ json: { projects } });
    }
    if (path === `/api/canvas/${canvasId}`) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        canvas.graph = body.graph;
        canvas.revision++;
      }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/agent/models") return route.fulfill({ json: [model] });
    if (path === "/api/agent/sessions") {
      if (request.method() === "POST") { sessionCreated = true; return route.fulfill({ json: session }); }
      return route.fulfill({ json: sessionCreated ? [{ id: session.id, title: session.title }] : [] });
    }
    if (path === `/api/agent/sessions/${session.id}`) return route.fulfill({ json: session });
    if (path === "/api/agent/turn") {
      const input = request.postDataJSON() as AgentTurnInput;
      turns.push(input);
      session.messages.push({ id: `user-${turns.length}`, role: "user", content: input.message, createdAt: now,
        metadata: { requestId: input.requestId, intent: input.intent, attachmentAssetIds: input.attachmentAssetIds } });
      if (input.intent === "canvas-plan") {
        session.plans = [{ ...structuredClone(plan), sourceRequestId: input.requestId }];
      } else {
        session.plans = session.plans.map((existing) => ({ ...existing, status: "cancelled", error: "本次画布任务授权已撤回，请明确发送新的制作请求。" }));
      }
      session.messages.push({ id: `assistant-${turns.length}`, role: "assistant", createdAt: now, metadata: {},
        content: input.intent === "canvas-plan" ? "方案准备好了，请先检查。" : "可以，我们先聊想法。" });
      return route.fulfill({ contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ type: "session", session })}\n\ndata: ${JSON.stringify({ type: "done", status: "succeeded" })}\n\n` });
    }
    if (request.method() === "POST" && (path === "/api/runs" || /\/plans\/[^/]+\/(materialize|preflight|execute)/u.test(path))) {
      productionRequests++;
      return route.abort("blockedbyclient");
    }
    if (path === "/api/assets/upload") return route.fulfill({ json: {
      id: "studio-reference", name: "参考.png", kind: "image", mimeType: "image/png", size: 7,
      storageKey: "fixture", createdAt: now, metadata: {},
    } });
    if (path === "/api/assets/studio-reference/content" && request.method() === "GET") return route.fulfill({
      contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
    if (path === "/api/assets") return route.fulfill({ json: [] });
    if (path === `/api/projects/${canvasId}/chat` && request.method() === "GET") return route.fulfill({ json: { messages: [] } });
    if (path === "/api/agent/legacy") return route.fulfill({ json: { sessions: [] } });
    // These GET routes return top-level arrays, including the foreground material-drop poll.
    if (request.method() === "GET" && ["/api/providers", "/api/suppliers", "/api/runs", "/api/integrations/material-drops"].includes(path)) {
      return route.fulfill({ json: [] });
    }
    unhandledApiRequests.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: `Missing studio fixture: ${request.method()} ${path}` } });
  });
  const expectNoUiErrors = async () => {
    await expect(page.locator('.toast-error, .agent-panel > [role="alert"]')).toHaveCount(0);
    expect(pageErrors, "浏览器不得出现未处理错误").toEqual([]);
    expect(await page.evaluate(() => (window as Window & { studioUiErrors?: string[] }).studioUiErrors), "不得出现瞬时错误提示").toEqual([]);
    expect(unhandledApiRequests, "每个 API mock 必须遵守实际接口契约").toEqual([]);
  };
  return { turns, createdTitles, session, canvas, expectNoUiErrors, counts: () => ({ productionRequests, externalRequests }) };
}

async function openStudio(page: Page) {
  await page.goto("/canvas/studio-chat-fixture");
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  const panel = page.getByRole("region", { name: "通用创作智能体" });
  await expect(panel.getByLabel("智能体模型", { exact: true })).toHaveValue("studio-connection\nstudio-chat");
  return panel;
}

test("首页聊天入口只打开对话工作区，不发送任务", async ({ page }, testInfo) => {
  // CanvasApp checks that its ID exists in the browser project list before loading the canvas.
  const fixture = await studioFixture(page, true);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "聊聊创作想法", exact: true })).toBeVisible();
  await fixture.expectNoUiErrors();
  await page.screenshot({ path: testInfo.outputPath("home-desktop.png") });
  await page.getByRole("button", { name: "聊聊创作想法", exact: true }).click();
  const panel = page.getByRole("region", { name: "通用创作智能体" });
  await expect(panel.getByRole("button", { name: "聊天", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/canvas\/studio-chat-fixture$/u);
  expect(fixture.createdTitles).toEqual(["创作对话"]);
  expect(fixture.turns).toHaveLength(0);
  expect(fixture.counts()).toEqual({ productionRequests: 0, externalRequests: 0 });
  await fixture.expectNoUiErrors();
  await page.screenshot({ path: testInfo.outputPath("home-chat-entry.png") });
});

test("日常聊天包含生成措辞和附件仍仅发送chat，模型设置可收起，窄屏无溢出", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await studioFixture(page);
  const panel = await openStudio(page);
  await expect(panel.getByRole("heading", { name: "有什么想法，聊聊吧。" })).toBeVisible();
  await panel.locator('input[type="file"]').setInputFiles({ name: "参考.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await expect(panel.getByRole("button", { name: "移除 参考.png", exact: true })).toBeVisible();
  await panel.getByLabel("创作任务要求").fill("聊聊‘生成一张产品图’这个想法，先讨论风格。");
  await panel.getByLabel("创作任务要求").press("Enter");
  await expect(panel.getByText("可以，我们先聊想法。", { exact: true })).toBeVisible();
  expect(fixture.turns).toHaveLength(1);
  expect(fixture.turns[0]).toMatchObject({ intent: "chat", attachmentAssetIds: ["studio-reference"] });
  expect(fixture.session.plans).toHaveLength(0);
  expect(fixture.canvas.graph.nodes).toHaveLength(0);
  await panel.getByText("对话模型", { exact: true }).click();
  await expect(panel.getByLabel("智能体模型", { exact: true })).not.toBeVisible();
  await panel.getByText("对话模型", { exact: true }).click();
  await expect(panel.getByLabel("智能体 API 供应商")).toHaveValue("studio-supplier");
  await expect(panel.getByLabel("智能体模型群组")).toHaveValue("创作组");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  expect(fixture.counts()).toEqual({ productionRequests: 0, externalRequests: 0 });
  await fixture.expectNoUiErrors();
  await page.screenshot({ path: testInfo.outputPath("chat-narrow.png") });
});

test("明确制作方案发送canvas-plan，完成回聊天；新聊天撤回历史方案入口", async ({ page }, testInfo) => {
  const fixture = await studioFixture(page);
  const panel = await openStudio(page);
  await panel.getByRole("button", { name: "制作画布方案", exact: true }).click();
  await panel.getByLabel("创作任务要求").fill("请制作一张产品主视觉的画布方案。");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  const confirm = panel.getByRole("button", { name: "第一次确认：放入画布" });
  await expect(confirm).toBeEnabled();
  expect(fixture.turns[0].intent).toBe("canvas-plan");
  await expect(panel.getByRole("button", { name: "聊天", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(fixture.counts()).toEqual({ productionRequests: 0, externalRequests: 0 });
  // Collapse the normal disclosures so the plan heading and confirmation fit together.
  await panel.getByText("对话模型", { exact: true }).click();
  await expect(panel.getByLabel("智能体模型", { exact: true })).not.toBeVisible();
  const planCard = panel.locator("article").filter({ has: page.getByRole("heading", { name: "产品主视觉方案", exact: true }) });
  await planCard.locator("summary").filter({ hasText: "产品主视觉 · image.generate" }).click();
  await expect(planCard.getByLabel("产品主视觉 提示词")).not.toBeVisible();
  await confirm.scrollIntoViewIfNeeded();
  await expect(planCard).toBeInViewport({ ratio: 1 });
  await expect(planCard.getByRole("heading", { name: "产品主视觉方案", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await fixture.expectNoUiErrors();
  await page.screenshot({ path: testInfo.outputPath("creation-plan-preview.png") });
  await panel.getByLabel("创作任务要求").fill("先不做了，我们聊聊别的方向。");
  await panel.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(panel.getByText("本次画布任务授权已撤回，请明确发送新的制作请求。", { exact: true })).toBeVisible();
  await expect(panel.getByText("已撤回 · 方案 v1", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "第一次确认：放入画布" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "第二次确认：开始生成" })).toHaveCount(0);
  expect(fixture.turns.map((turn) => turn.intent)).toEqual(["canvas-plan", "chat"]);
  expect(fixture.canvas.graph.nodes).toHaveLength(0);
  expect(fixture.counts()).toEqual({ productionRequests: 0, externalRequests: 0 });
  await fixture.expectNoUiErrors();
});
