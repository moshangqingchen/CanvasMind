import { expect, test, type Locator, type Page } from "@playwright/test";
import type { CanvasNode } from "../components/types";

const models = [
  { id: "gpt-image-2", name: "失败回归模型甲" },
  { id: "gpt-image-2.5", name: "失败回归模型乙" },
].map((model) => ({
  ...model,
  operations: ["image.generate"],
  inputKinds: ["text"],
  outputKinds: ["image"],
  metadata: { canvasRunnable: true },
  parameters: [
    {
      key: "quality", label: "质量", control: "select", default: "high",
      options: ["low", "high"].map((value) => ({ value, label: value })),
    },
    { key: "n", label: "数量", control: "number", default: 1, min: 1, max: 4 },
  ],
}));

async function chooseNativeOption(page: Page, select: Locator, value: string) {
  // selectOption bypasses the pointer sequence that previously closed native
  // dropdowns when canvas selection changed between pointerdown and click.
  await select.click();
  await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(true);
  const index = await select.locator("option").evaluateAll(
    (options, target) => options.findIndex((option) => (option as HTMLOptionElement).value === target),
    value,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Home");
  for (let indexToChoose = 0; indexToChoose < index; indexToChoose++)
    await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue(value);
}

async function dragSelectedNodesFromGap(page: Page, source: Locator, result: Locator) {
  const selection = page.locator(".react-flow__nodesselection-rect");
  const sourceBefore = await source.boundingBox();
  const resultBefore = await result.boundingBox();
  expect(sourceBefore).not.toBeNull();
  expect(resultBefore).not.toBeNull();
  expect(resultBefore!.x).toBeGreaterThan(sourceBefore!.x + sourceBefore!.width);
  // Use the narrow gap between the cards, above the attached panel and group
  // toolbar. It should still expose the selection rectangle for group drag.
  const point = {
    x: (sourceBefore!.x + sourceBefore!.width + resultBefore!.x) / 2,
    y: Math.max(sourceBefore!.y, resultBefore!.y) + 20,
  };
  expect(await selection.evaluate((element, position) =>
    document.elementFromPoint(position.x, position.y) === element, point)).toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  try { await page.mouse.move(point.x + 30, point.y + 20, { steps: 6 }); }
  finally { await page.mouse.up(); }
  await expect.poll(async () => (await source.boundingBox())!.x - sourceBefore!.x).toBeGreaterThan(15);
  const sourceAfter = await source.boundingBox();
  const resultAfter = await result.boundingBox();
  expect(resultAfter!.x - resultBefore!.x).toBeCloseTo(sourceAfter!.x - sourceBefore!.x, 0);
  expect(resultAfter!.y - resultBefore!.y).toBeCloseTo(sourceAfter!.y - sourceBefore!.y, 0);
}

for (const failure of ["submission", "provider", "multi-selection", "marquee-selection"] as const) {
  test(`${failure}: 生成失败且结果被选中后仍能点击模型参数并保存`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const connections: { id: string; supplierKey: string }[] = [];
    for (const name of ["失败参数供应商甲", "失败参数供应商乙"]) {
      const response = await request.post("/api/suppliers", {
        data: { name, siteUrl: "https://failed-panel.invalid", apiUrl: "https://failed-panel.invalid" },
      });
      expect(response.ok()).toBeTruthy();
      const supplier = await response.json();
      for (const group of ["高质量", "标准"]) {
        const providerResponse = await request.post("/api/providers", {
          data: {
            name: `${name} · ${group}`, provider: "openai", apiKey: "isolated-failed-parameters-test",
            config: {
              supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl,
              usage: "canvas", customGroup: true, modelGroup: group, defaultModel: models[0]!.id,
            },
          },
        });
        expect(providerResponse.ok()).toBeTruthy();
        const connection = await providerResponse.json();
        connections.push({ id: connection.id, supplierKey: supplier.supplierKey });
        await page.route(`**/api/providers/${connection.id}/models*`, (route) => route.fulfill({
          json: models, headers: { "X-Model-Scan-Status": "live" },
        }));
      }
    }

    const response = await request.post("/api/canvas", { data: {
      title: "失败结果参数交互回归", graph: {
        schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
          id: "source", type: "workflow", position: { x: 55, y: 70 }, style: { width: 420, height: 180 },
          data: {
            nodeType: "image-generation", label: "失败参数测试", provider: "openai",
            connectionId: connections[0]!.id, model: models[0]!.id,
            parts: [{ type: "text", text: "隔离浏览器测试，不向供应商发起请求" }],
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
            outputs: [{ id: "images", kind: "image", label: "图片" }], parameters: { quality: "high", n: 1 },
          },
        }],
      },
    } });
    expect(response.ok()).toBeTruthy();
    const canvas = await response.json();
    const snapshot = {
      run: { id: "failed-parameters-run", canvasId: canvas.id, scope: "node", nodeId: "source", status: "failed", createdAt: new Date().toISOString() },
      nodes: [{ id: "failed-parameters-node-run", nodeId: "source", status: "failed", outputAssetIds: [], errorJson: { message: "隔离测试：供应商生成失败", code: "TEST_PROVIDER_FAILURE" } }],
    };
    let submissions = 0;
    // Mock the complete run API, including a successful task submission whose
    // provider subsequently fails. No generation can reach a paid endpoint.
    await page.route(/\/api\/runs(?:\?|\/|$)/u, async (route) => {
      if (route.request().method() === "POST") {
        submissions++;
        return route.fulfill(failure === "submission"
          ? { status: 400, json: { error: "隔离测试：生成请求被拒绝" } }
          : { json: snapshot });
      }
      return route.fulfill({ json: new URL(route.request().url()).pathname === "/api/runs"
        ? failure !== "submission" && submissions ? [snapshot] : []
        : snapshot });
    });

    await page.goto(`/canvas/${canvas.id}`);
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if ((await sidebar.getAttribute("aria-expanded")) === "true") await sidebar.click();
    const source = page.locator('.react-flow__node[data-id="source"]');
    await page.getByRole("button", { name: "打开 失败参数测试 模型与参数", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "失败参数测试 模型与参数", exact: true });
    await expect(panel).toBeVisible();
    await expect(source.locator(".node-config-summary strong")).toHaveText("失败回归模型甲");
    await page.getByRole("button", { name: "运行 失败参数测试 节点", exact: true }).click();
    const result = page.locator(".react-flow__node:has(.generated-result-state.failed)");
    await expect(result).toHaveCount(1);
    await expect(result.locator(".result-error-summary")).toContainText("隔离测试：");
    await expect.poll(() => submissions).toBe(1);

    await expect(panel).toBeVisible();
    const multiple = failure === "multi-selection" || failure === "marquee-selection";
    if (failure === "marquee-selection") {
      const sourceBounds = await source.boundingBox();
      const resultBounds = await result.boundingBox();
      expect(sourceBounds).not.toBeNull();
      expect(resultBounds).not.toBeNull();
      await page.keyboard.down("Control");
      try {
        await page.mouse.move(Math.min(sourceBounds!.x, resultBounds!.x) - 15, Math.min(sourceBounds!.y, resultBounds!.y) - 15);
        await page.mouse.down();
        await page.mouse.move(
          Math.max(sourceBounds!.x + sourceBounds!.width, resultBounds!.x + resultBounds!.width) + 15,
          Math.max(sourceBounds!.y + sourceBounds!.height, resultBounds!.y + resultBounds!.height) + 15,
          { steps: 12 },
        );
        await page.mouse.up();
      } finally { await page.keyboard.up("Control"); }
      await expect(page.locator(".react-flow__nodesselection-rect")).toBeVisible();
    } else await result.locator(".generated-result-state strong").first().click(
      multiple ? { modifiers: ["Control"] } : {},
    );
    await expect(result).toHaveClass(/selected/);
    if (multiple) await expect(source).toHaveClass(/selected/);
    else await expect(source).not.toHaveClass(/selected/);
    await expect(panel).toBeVisible();
    if (failure === "marquee-selection") await dragSelectedNodesFromGap(page, source, result);

    const supplier = panel.getByRole("combobox", { name: "失败参数测试 供应商", exact: true });
    const group = panel.getByRole("combobox", { name: "失败参数测试 模型群组", exact: true });
    await expect.poll(() => supplier.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { inside: hit === element || element.contains(hit), hitClass: hit?.className ?? "" };
    })).toMatchObject({ inside: true });
    await chooseNativeOption(page, supplier, connections[2]!.supplierKey);
    await chooseNativeOption(page, group, "标准");
    const model = panel.getByRole("combobox", { name: "失败参数测试 模型", exact: true });
    await model.click();
    await expect(model).toHaveAttribute("aria-expanded", "true");
    await panel.getByRole("option", { name: "失败回归模型乙", exact: true }).click();
    await expect(model).toHaveAttribute("aria-expanded", "false");
    const quality = panel.getByRole("combobox", { name: "质量", exact: true });
    await chooseNativeOption(page, quality, "low");
    const quantity = panel.getByRole("spinbutton", { name: "数量", exact: true });
    await quantity.click();
    await expect(quantity).toBeFocused();
    await quantity.fill("2");
    await expect(quantity).toHaveValue("2");
    await expect(result).toHaveClass(/selected/);
    if (multiple) await expect(source).toHaveClass(/selected/);
    else await expect(source).not.toHaveClass(/selected/);

    const savedSource = async () => {
      const saved = await (await request.get(`/api/canvas/${canvas.id}`)).json();
      return saved.graph.nodes.find((node: CanvasNode) => node.id === "source")?.data;
    };
    await expect.poll(savedSource).toMatchObject({
      connectionId: connections[3]!.id, model: models[1]!.id, parameters: { quality: "low", n: 2 },
    });
    await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
    await expect(panel).toBeHidden();
    if (failure === "marquee-selection") await dragSelectedNodesFromGap(page, source, result);
    await page.reload();
    await expect(result).toHaveCount(1);
    await page.getByRole("button", { name: "打开 失败参数测试 模型与参数", exact: true }).click();
    await expect(supplier).toHaveValue(connections[2]!.supplierKey);
    await expect(group).toHaveValue("标准");
    await expect(model).toContainText("失败回归模型乙");
    await expect(quality).toHaveValue("low");
    await expect(quantity).toHaveValue("2");
    expect(submissions).toBe(1);
  });
}
