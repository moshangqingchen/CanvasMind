import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import type { RunErrorDetails, RunSnapshot } from "../components/types";

async function failedGeneration(page: Page, request: APIRequestContext, error: () => RunErrorDetails, supplier = "custom:isolated") {
  const response = await request.post("/api/canvas", { data: {
    title: "失败诊断隔离验收",
    graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "source", type: "workflow", position: { x: 50, y: 100 }, style: { width: 420, height: 210 },
      data: { nodeType: "image-generation", label: "诊断验收", provider: "fake", connectionId: "fake-default",
        model: "fake-image-v1", fakeScenario: "fail", parts: [{ type: "text", text: "本地模拟，不调用付费接口" }],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }],
        parameters: { n: 1 } },
    }] },
  } });
  expect(response.ok()).toBe(true);
  const canvas = await response.json();
  let submissions = 0;
  const present = (snapshot: RunSnapshot): RunSnapshot => ({ ...snapshot,
    run: { ...snapshot.run, status: "failed", canResume: false, canRecoverOutputs: false },
    nodes: snapshot.nodes.map(node => ({ ...node, status: "failed", outputAssetIds: [],
      request: { provider: "rest", supplier, connectionName: "测试图片渠道", model: "test-image", operation: "image.generate" },
      taskEvidence: error().charge?.source === "not_submitted" ? undefined : { taskId: "supplier-task-isolated", status: "failed" },
      errorJson: error(),
    })),
  });
  await page.route(/\/api\/runs(?:\/[^/?]+)?(?:\?.*)?$/u, async route => {
    if (route.request().method() === "POST") submissions++;
    const upstream = await route.fetch();
    const payload = await upstream.json();
    await route.fulfill({ response: upstream, json: Array.isArray(payload) ? payload.map(present) : present(payload) });
  });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "运行 诊断验收 节点", exact: true }).click();
  const state = page.locator(".generated-result-state").first();
  await expect(state.getByLabel("失败诊断")).toBeVisible();
  return { state, submissions: () => submissions, canvasId: canvas.id };
}

const cases: Array<{ name: string; error: RunErrorDetails; reason: RegExp; charge: RegExp; amount?: RegExp; forbidden?: RegExp; supplier?: string; balanceLink?: boolean }> = [
  { name: "历史24小时内容拦截纠正为真实原因", reason: /24 小时拦截期/, charge: /扣费待确认/, forbidden: /请求参数不符合要求|API 拒绝了当前请求/,
    error: { message: "API 拒绝了当前请求，请检查模型、参数、提示词和素材格式。", type: "请求参数错误",
      code: "content_blocked_24h", statusCode: 451, failureCategory: "invalid_request", charge: { status: "unknown", source: "unconfirmed" } } },
  { name: "余额不足且供应商明确未扣费", reason: /余额.*不足/, charge: /未扣费/, supplier: "cyberafei", balanceLink: true,
    error: { message: "Insufficient balance", failureCategory: "insufficient_balance",
      charge: { status: "not_charged", amount: 0, source: "provider_response" } } },
  { name: "供应商缺号不冒充本地问题或未扣费", reason: /供应商.*(?:账号|容量)/, charge: /扣费待确认/,
    error: { message: "No available compatible accounts", failureCategory: "supplier_capacity",
      charge: { status: "unknown", source: "unconfirmed" } } },
  { name: "本地连接失败且请求尚未发送", reason: /本(?:地|机)网络/, charge: /未扣费/,
    error: { message: "本地代理连接失败，请求尚未提交", failureCategory: "local_network", phase: "submit",
      submissionMayHaveOccurred: false, charge: { status: "not_charged", amount: 0, source: "not_submitted" } } },
  { name: "供应商失败但已扣费保留精确金额", reason: /供应商/, charge: /已扣费/, amount: /0\.125/,
    error: { message: "Provider failed after billing", failureCategory: "supplier_error",
      charge: { status: "charged", amount: 0.125, currency: "CNY", source: "provider_response" } } },
  { name: "链路中断不猜测扣费结果", reason: /网络/, charge: /扣费待确认/,
    error: { message: "Connection reset after submission", failureCategory: "network", phase: "submit",
      submissionMayHaveOccurred: true, charge: { status: "unknown", source: "unconfirmed" } } },
  { name: "有金额但缺币种不擅自标人民币", reason: /供应商/, charge: /已扣费/, amount: /币种.*单位.*未提供/,
    error: { message: "Provider failed", failureCategory: "supplier_error",
      charge: { status: "charged", amount: 2.5, source: "provider_response" } } },
  { name: "上游账号余额不足不要求用户充值", reason: /供应商.*(?:账号|容量)/, charge: /扣费待确认/, forbidden: /请充值|官网查看余额/, supplier: "cyberafei",
    error: { message: "供应商暂无可用账号", providerMessage: "upstream account insufficient balance", failureCategory: "supplier_capacity",
      code: "provider_no_compatible_accounts", charge: { status: "unknown", source: "unconfirmed" } } },
];

for (const scenario of cases) test(`失败原因与扣费贯穿结果和历史：${scenario.name}`, async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await failedGeneration(page, request, () => scenario.error, scenario.supplier);
  const diagnosis = fixture.state.getByLabel("失败诊断");
  await expect(diagnosis).toContainText(scenario.reason);
  await expect(diagnosis).toContainText(scenario.charge);
  await expect(diagnosis).toContainText("下一步");
  if (scenario.amount) await expect(diagnosis).toContainText(scenario.amount);
  if (scenario.forbidden) await expect(fixture.state).not.toContainText(scenario.forbidden);
  if (scenario.balanceLink) {
    await fixture.state.locator(".result-error-details summary").click();
    await expect(fixture.state.getByRole("link", { name: /官网查看余额/ })).toHaveAttribute("href", "https://api.3365api.cn/");
  }
  await page.reload();
  await expect(diagnosis).toContainText(scenario.reason);
  await expect(diagnosis).toContainText(scenario.charge);
  await fixture.state.getByRole("button", { name: /查看 .* 来源/ }).click();
  const details = page.getByRole("dialog", { name: "结果来源与参数" });
  await expect(details.getByLabel("失败诊断")).toContainText(scenario.reason);
  await expect(details.getByLabel("失败诊断")).toContainText(scenario.charge);
  if (scenario.amount) await expect(details.getByLabel("失败诊断")).toContainText(scenario.amount);
  if (scenario.forbidden) await expect(details).not.toContainText(scenario.forbidden);
  await expect(details.getByText(/当前为第\s*\d+\s*张/)).toHaveCount(0);
  if (scenario.name.includes("精确金额")) {
    await page.screenshot({ path: testInfo.outputPath("generation-failure-charge.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(details.getByLabel("失败诊断")).toBeVisible();
    await expect(details.getByRole("button", { name: "关闭来源详情" })).toBeInViewport();
    expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("generation-failure-charge-narrow.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await details.getByRole("button", { name: "关闭来源详情" }).click();
  await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "运行历史" });
  await expect(history.getByLabel("失败诊断").first()).toBeVisible();
  await expect(history.getByLabel("失败诊断").first()).toContainText(scenario.reason);
  await expect(history.getByLabel("失败诊断").first()).toContainText(scenario.charge);
  if (scenario.amount) await expect(history.getByLabel("失败诊断").first()).toContainText(scenario.amount);
  if (scenario.forbidden) await expect(history).not.toContainText(scenario.forbidden);
  if (scenario.balanceLink) await expect(history.getByRole("link", { name: /官网查看余额/ }).first()).toHaveAttribute("href", "https://api.3365api.cn/");
  expect(fixture.submissions()).toBe(1);
});

for (const status of ["succeeded", "cancelled"] as const) test(`来源详情以最新${status}状态覆盖旧失败诊断`, async ({ page, request }, testInfo) => {
  const oldError: RunErrorDetails = { message: "旧任务余额不足，请充值", failureCategory: "insufficient_balance",
    charge: { status: "unknown", source: "unconfirmed" } };
  const canvasResponse = await request.post("/api/canvas", { data: { title: "来源状态复查", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "result", type: "workflow", position: { x: 160, y: 110 }, style: { width: 360, height: 220 },
      data: { nodeType: "asset-input", label: "状态复查", assetKind: "image", generatedResult: true,
        generatedStatus: "failed", generatedFromRunId: "latest-status-run", generatedFromNodeId: "source",
        generatedError: oldError, generatedProvider: "rest", inputs: [], outputs: [] },
    }],
  } } });
  expect(canvasResponse.ok()).toBe(true);
  const canvas = await canvasResponse.json();
  const cancelledError: RunErrorDetails = { message: "用户已取消运行", charge: {
    status: "charged", amount: 0.25, currency: "USD", source: "provider_response",
  } };
  await page.route("**/api/runs/latest-status-run?details=1", route => route.fulfill({ json: {
    run: { id: "latest-status-run", status }, nodes: [{ id: "latest-node", nodeId: "source", status,
      outputAssetIds: [], errorJson: status === "succeeded" ? null : cancelledError,
      request: { provider: "rest", operation: "image.generate", model: "test-image" },
    }],
  } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "查看 状态复查 来源", exact: true }).click();
  const details = page.getByRole("dialog", { name: "结果来源与参数" });
  const taskStatus = details.getByText("任务状态", { exact: true }).locator("+ dd");
  await expect(taskStatus).toContainText(status === "succeeded" ? /完成|成功/ : /取消/);
  await expect(details).not.toContainText(oldError.message);
  if (status === "succeeded") {
    await expect(details.getByLabel("完整错误详情")).toHaveCount(0);
    await expect(details.getByLabel("失败诊断")).toHaveCount(0);
    await expect(details).not.toContainText("扣费待确认");
  } else {
    const cancellation = details.getByRole("group", { name: "取消信息", exact: true });
    await expect(cancellation).toBeVisible();
    await expect(cancellation).toContainText("已扣费");
    await expect(cancellation).toContainText("0.25 USD");
    await expect(cancellation).toContainText("取消原因");
    await expect(cancellation).not.toContainText("失败原因");
    await expect(cancellation).toContainText(/取消.*(?:不代表|不等于).*退款/);
  }
  await page.screenshot({ path: testInfo.outputPath(`latest-source-${status}.png`) });
});

test("错误文案不变时后续扣费证据仍会更新并保存", async ({ page, request }) => {
  let current: RunErrorDetails = { message: "Provider failed", failureCategory: "supplier_error",
    charge: { status: "unknown", source: "unconfirmed" } };
  const fixture = await failedGeneration(page, request, () => current);
  await expect(fixture.state.getByLabel("失败诊断")).toContainText("扣费待确认");
  current = { ...current, charge: { status: "charged", amount: 0.37, currency: "USD", source: "provider_response" } };
  await page.reload();
  await expect(fixture.state.getByLabel("失败诊断")).toContainText("已扣费");
  await expect(fixture.state.getByLabel("失败诊断")).toContainText("0.37");
  await expect.poll(async () => {
    const canvas = await (await request.get(`/api/canvas/${fixture.canvasId}`)).json();
    return canvas.graph.nodes.find((node: { data: { generatedResult?: boolean } }) => node.data.generatedResult)?.data.generatedError?.charge;
  }).toMatchObject({ status: "charged", amount: 0.37, currency: "USD" });
  expect(fixture.submissions()).toBe(1);
});
