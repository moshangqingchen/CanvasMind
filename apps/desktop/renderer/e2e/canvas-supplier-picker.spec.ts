import { expect, test, type Locator, type Page } from "@playwright/test";
import { clickBlankCanvas } from "./canvas-test-actions";

async function chooseOpenNativeOption(
  page: Page,
  select: Locator,
  value: string,
) {
  const index = await select
    .locator("option")
    .evaluateAll(
      (options, target) =>
        options.findIndex(
          (option) => (option as HTMLOptionElement).value === target,
        ),
      value,
    );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Home");
  for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue(value);
}

for (const zoom of [0.4, 1, 1.74])
  test(`供应商与群组实际点击切换并保存（${Math.round(zoom * 100)}% 缩放）`, async ({
    page,
    request,
  }) => {
    const models = [
      {
        id: "gpt-image-2",
        name: "图像模型",
        operations: ["image.generate"],
        inputKinds: ["text"],
        outputKinds: ["image"],
        metadata: { canvasRunnable: true },
        parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: ["low", "high"].map(value => ({ value, label: value })) }],
      },
      {
        id: "gpt-image-2.5",
        name: "另一图像模型",
        isDefault: true,
        operations: ["image.generate"],
        inputKinds: ["text"],
        outputKinds: ["image"],
        metadata: { canvasRunnable: true },
        parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: ["low", "high", "max"].map(value => ({ value, label: value })) }],
      },
    ];
    const connections: { id: string; supplierKey: string; group: string }[] =
      [];
    for (const name of [`供应商甲 ${zoom}`, `供应商乙 ${zoom}`]) {
      const response = await request.post("/api/suppliers", {
        data: {
          name,
          siteUrl: "https://picker.invalid",
          apiUrl: "https://picker.invalid",
        },
      });
      expect(response.ok()).toBeTruthy();
      const supplier = await response.json();
      for (const group of ["高质量", "标准"]) {
        const connectionResponse = await request.post("/api/providers", {
          data: {
            name: `${name} · ${group}`,
            provider: "openai",
            apiKey: "isolated-picker-test",
            config: {
              supplierId: supplier.id,
              supplierKey: supplier.supplierKey,
              baseUrl: supplier.apiUrl,
              usage: "canvas",
              customGroup: true,
              modelGroup: group,
              defaultModel: "gpt-image-2.5",
            },
          },
        });
        expect(connectionResponse.ok()).toBeTruthy();
        const connection = await connectionResponse.json();
        connections.push({
          id: connection.id,
          supplierKey: supplier.supplierKey,
          group,
        });
        await page.route(`**/api/providers/${connection.id}/models*`, (route) =>
          route.fulfill({
            json: models,
            headers: { "X-Model-Scan-Status": "live" },
          }),
        );
      }
    }
    let submitted = 0;
    await page.route("**/api/runs", async (route) => {
      if (route.request().method() === "POST") submitted++;
      await route.continue();
    });
    const response = await request.post("/api/canvas", {
      data: {
        title: "供应商鼠标回归",
        graph: {
          schemaVersion: 1,
          // Keep the 40% panel exposed to real pointer input beside the floating rail.
          viewport: { x: zoom < 0.5 ? 140 : 0, y: 0, zoom },
          edges: [],
          nodes: [
            {
              id: "source",
              type: "workflow",
              position: { x: 55, y: 70 },
              style: { width: 420, height: 180 },
              data: {
                nodeType: "image-generation",
                label: "选择测试",
                provider: "openai",
                connectionId: connections[0]!.id,
                model: "gpt-image-2",
                parts: [],
                inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
                outputs: [{ id: "images", kind: "image", label: "图片" }],
                parameters: { quality: "high" },
              },
            },
          ],
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    const canvas = await response.json();
    await page.goto(`/canvas/${canvas.id}`);
    const sidebar = page.getByRole("button", {
      name: "智能体面板",
      exact: true,
    });
    if ((await sidebar.getAttribute("aria-expanded")) === "true")
      await sidebar.click();
    await page
      .getByRole("button", { name: "打开 选择测试 模型与参数", exact: true })
      .click();
    if (zoom < 0.5) {
      await expect(page.locator(".canvas-zoom-value")).toHaveText("40%");
      const panel = page.getByRole("dialog", { name: "选择测试 模型与参数", exact: true });
      await expect.poll(async () => {
        const [box, rail, pane] = await Promise.all([
          panel.boundingBox(), page.getByRole("navigation", { name: "创作工具", exact: true }).boundingBox(),
          page.locator(".react-flow__pane").boundingBox(),
        ]);
        return Boolean(box && rail && pane && box.x >= rail.x + rail.width + 16 &&
          box.y >= pane.y && box.x + box.width <= pane.x + pane.width &&
          box.y + box.height <= pane.y + pane.height);
      }, { message: "40% 参数面板应位于可见画布内，避开创作轨栏" }).toBe(true);
    }
    // The popover remains open after clearing canvas selection. Opening a field
    // must not reselect its node or open the inspector over the native popup.
    await clickBlankCanvas(page);
    await expect(
      page.locator('.react-flow__node[data-id="source"]'),
    ).not.toHaveClass(/selected/);
    const selectionState = await sidebar.getAttribute("aria-expanded");
    const supplier = page.getByRole("combobox", {
      name: "选择测试 供应商",
      exact: true,
    });
    await supplier.click();
    await expect
      .poll(() => supplier.evaluate((el) => el.matches(":open")))
      .toBe(true);
    await page.waitForTimeout(250);
    await expect(
      page.locator('.react-flow__node[data-id="source"]'),
    ).not.toHaveClass(/selected/);
    await expect(sidebar).toHaveAttribute("aria-expanded", selectionState!);
    await chooseOpenNativeOption(page, supplier, connections[2]!.supplierKey);
    const quality = page.getByRole("dialog", { name: "选择测试 模型与参数" }).getByLabel("质量", { exact: true });
    await expect(quality).toHaveValue("max");
    const group = page.getByRole("combobox", {
      name: "选择测试 模型群组",
      exact: true,
    });
    await group.click();
    await expect
      .poll(() => group.evaluate((el) => el.matches(":open")))
      .toBe(true);
    await chooseOpenNativeOption(page, group, "标准");
    await expect(quality).toHaveValue("max");
    await quality.selectOption("low");
    await page.getByRole("combobox", { name: "选择测试 模型", exact: true }).click();
    await page.getByRole("option", { name: "图像模型", exact: true }).click();
    await expect(quality).toHaveValue("high");
    await page.getByRole("combobox", { name: "选择测试 模型", exact: true }).click();
    await page.getByRole("option", { name: "另一图像模型", exact: true }).click();
    await expect(quality).toHaveValue("max");
    await expect(page.locator('.react-flow__node[data-id="source"]')).not.toHaveClass(/selected/);
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph
            .nodes[0].data.connectionId,
      )
      .toBe(connections[3]!.id);
    await expect.poll(async () =>
      (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.model,
    ).toBe("gpt-image-2.5");
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data)
      .toMatchObject({ qualityMode: "highest", parameters: { quality: "max" } });
    // Escape and Tab must retain native select keyboard behavior without selecting the canvas node.
    await supplier.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(() => supplier.evaluate((el) => el.matches(":open")))
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(
      page.locator('.react-flow__node[data-id="source"]'),
    ).not.toHaveClass(/selected/);
    await page.reload();
    await page
      .getByRole("button", { name: "打开 选择测试 模型与参数", exact: true })
      .click();
    await expect(supplier).toHaveValue(connections[2]!.supplierKey);
    await expect(group).toHaveValue("标准");
    await expect(quality).toHaveValue("max");
    expect(submitted).toBe(0);
  });

test("同群组多连接保留身份，旧智能体 Key 的图片模型可选择且最近记录不串连接", async ({ page, request }) => {
  const models = Array.from({ length: 100 }, (_, index) => ({
    id: index ? `picker-image-${String(index).padStart(3, "0")}` : "gpt-image-2",
    name: `列表模型 ${String(index).padStart(3, "0")}`,
    operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
    metadata: { canvasRunnable: index !== 98, priceLabel: "¥0.1/张", ...(index === 97 ? { imageCapabilitiesVerifiedAt: "2026-09-22" } : {}) },
  }));
  const supplierResponse = await request.post("/api/suppliers", { data: { name: "多连接选择回归", siteUrl: "https://multi-picker.invalid", apiUrl: "https://multi-picker.invalid" } });
  expect(supplierResponse.ok()).toBeTruthy();
  const supplier = await supplierResponse.json();
  const ids: string[] = [];
  for (const name of ["工作账户", "备用账户", "未配置账户", "停用账户"]) {
    const response = await request.post("/api/providers", { data: {
      name, provider: "openai", ...(name !== "未配置账户" ? { apiKey: "isolated-picker-test" } : {}),
      config: { supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl,
        usage: name === "停用账户" ? "disabled" : name === "备用账户" ? "agent" : "canvas", customGroup: true, modelGroup: "共享群组", defaultModel: "gpt-image-2" },
    } });
    expect(response.ok()).toBeTruthy();
    const connection = await response.json();
    ids.push(connection.id);
    await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } }));
  }
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); } else await route.continue();
  });
  const response = await request.post("/api/canvas", { data: { title: "多连接和大目录回归", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "multi-source", type: "workflow",
      position: { x: 55, y: 70 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation", label: "多连接测试",
        provider: "openai", connectionId: ids[2], model: "gpt-image-2", parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }], parameters: {} } }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const savedData = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  await page.goto(`/canvas/${canvas.id}`);
  const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
  if ((await sidebar.getAttribute("aria-expanded")) === "true") await sidebar.click();
  await page.getByRole("button", { name: "打开 多连接测试 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "多连接测试 模型与参数", exact: true });
  const group = panel.getByRole("combobox", { name: "多连接测试 模型群组", exact: true });
  const connection = panel.getByRole("combobox", { name: "多连接测试 API 连接", exact: true });
  await expect(connection).toHaveValue(ids[2]!);
  await expect(connection.locator(`option[value="${ids[1]}"]`)).toBeEnabled();
  await expect(connection.locator(`option[value="${ids[3]}"]`)).toHaveCount(0);
  await expect(group.locator('option[value="共享群组"]')).toBeEnabled();
  await expect(panel.getByText(/当前实际连接是 未配置账户/)).toBeVisible();
  expect((await savedData()).connectionId).toBe(ids[2]);
  await connection.selectOption(ids[1]!);
  const picker = panel.getByRole("combobox", { name: "多连接测试 模型", exact: true });
  await expect(picker).toContainText("列表模型 000");
  await picker.click();
  const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
  await expect(search).toBeFocused();
  await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(40);
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(panel.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
  await expect(search).toBeFocused();
  await search.press("End");
  await expect(panel.getByRole("option", { name: "列表模型 099", exact: true })).toBeVisible();
  await search.press("Home");
  await expect(panel.getByRole("option", { name: "自动模型", exact: true })).toBeVisible();
  await search.fill("picker-image-097");
  await panel.getByLabel("模型状态筛选").selectOption("verified");
  await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(1);
  await expect(panel.getByRole("option", { name: "列表模型 097", exact: true })).toHaveAccessibleDescription(/ID: picker-image-097.*¥0.1\/张/u);
  await search.focus();
  await search.press("Enter");
  await expect(picker).toBeFocused();
  await expect(picker).toContainText("picker-image-097");
  await expect.poll(async () => ({ connection: (await savedData()).connectionId, model: (await savedData()).model })).toEqual({ connection: ids[1], model: "picker-image-097" });
  await picker.click();
  await panel.getByLabel("模型状态筛选").selectOption("recent");
  await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(1);
  await search.focus();
  await search.press("Escape");
  await expect(panel).toBeVisible();
  await expect(picker).toBeFocused();
  await connection.selectOption(ids[0]!);
  await picker.click();
  await panel.getByLabel("模型状态筛选").selectOption("recent");
  await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(0);
  expect(submissions).toBe(0);
});
