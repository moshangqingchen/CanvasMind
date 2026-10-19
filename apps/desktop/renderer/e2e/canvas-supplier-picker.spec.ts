import { expect, test } from "./helpers/canvas-offline-test";
import { clickBlankCanvas, setCanvasZoomWithWheel } from "./canvas-test-actions";
import { floatingPanelGeometry } from "./floating-panel-geometry";
import { chooseParameterOption, expectParameterValue } from "./helpers/parameter-controls";

for (const zoom of [0.4, 1, 1.74])
  test(`供应商与群组实际点击切换并保存（${Math.round(zoom * 100)}% 缩放）`, async ({
    page,
    request,
  }, testInfo) => {
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
      if (route.request().method() === "POST") { submitted++; await route.abort(); }
      else await route.continue();
    });
    const response = await request.post("/api/canvas", {
      data: {
        title: `供应商鼠标回归 ${crypto.randomUUID()}`,
        graph: {
          schemaVersion: 1,
          // Compact LOD intentionally hides the footer trigger. Open at 1x,
          // then retain all real-pointer/route-popup checks at 40% below.
          viewport: { x: zoom < 0.5 ? 140 : 0, y: 0, zoom: zoom < .55 ? 1 : zoom },
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
    const savedData = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
    await page.goto(`/canvas/${canvas.id}`);
    const sidebar = page.getByRole("button", {
      name: "智能体面板",
      exact: true,
    });
    await page
      .getByRole("button", { name: "打开 选择测试 模型与参数", exact: true })
      .click();
    // Opening the panel selects its node and can open the inspector. Close it
    // afterwards so 174% has room for the attached panel before real clicks;
    // scrolling an off-canvas field into view is not a pointer-popup test.
    if ((await sidebar.getAttribute("aria-expanded")) === "true")
      await sidebar.click();
    await expect(sidebar).toHaveAttribute("aria-expanded", "false");
    const panel = page.getByRole("dialog", { name: "选择测试 模型与参数", exact: true });
    if (zoom < .55) await setCanvasZoomWithWheel(page, zoom);
    await expect.poll(async () => (await floatingPanelGeometry(panel)).floatingError)
      .toBeLessThanOrEqual(1);
    if (zoom < 0.5) {
      await expect(page.locator(".canvas-zoom-value")).toHaveText("40%");
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
    // must not reselect its node or open the inspector over the route popup.
    await clickBlankCanvas(page);
    await expect(
      page.locator('.react-flow__node[data-id="source"]'),
    ).not.toHaveClass(/selected/);
    const selectionState = await sidebar.getAttribute("aria-expanded");
    const routeTrigger = panel.getByRole("button", { name: "选择测试 线路", exact: true });
    const routes = panel.getByRole("dialog", { name: "选择测试 候选线路", exact: true });
    const routeChoice = (id: string) => routes.locator(`[data-route-id="${id}"] [data-route-choice]`);
    await expect.poll(() => routeTrigger.evaluate(element => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === element;
    }), { message: "线路入口的真实点击位置应可见且未被遮挡" }).toBe(true);
    await routeTrigger.click();
    await expect(routes).toBeVisible();
    await page.waitForTimeout(250);
    await expect(
      page.locator('.react-flow__node[data-id="source"]'),
    ).not.toHaveClass(/selected/);
    await expect(sidebar).toHaveAttribute("aria-expanded", selectionState!);
    const supplierModelsPath = `/api/providers/${connections[2]!.id}/models`;
    const [supplierModelsRequest] = await Promise.all([
      page.waitForRequest(request => request.method() === "GET" && new URL(request.url()).pathname === supplierModelsPath),
      routeChoice(connections[2]!.id).click(),
    ]);
    // The active floating editor must keep loading its new connection after canvas selection was cleared.
    expect(new URL(supplierModelsRequest.url()).pathname).toBe(supplierModelsPath);
    const quality = page.getByRole("dialog", { name: "选择测试 模型与参数" }).getByLabel("质量", { exact: true });
    await expectParameterValue(quality, "max");
    await expect(panel.getByLabel("当前线路", { exact: true })).toContainText(`供应商乙 ${zoom} › 高质量`);
    await routeTrigger.click();
    await expect(routes).toBeVisible();
    const groupModelsPath = `/api/providers/${connections[3]!.id}/models`;
    const [groupModelsRequest] = await Promise.all([
      page.waitForRequest(request => request.method() === "GET" && new URL(request.url()).pathname === groupModelsPath),
      routeChoice(connections[3]!.id).click(),
    ]);
    expect(new URL(groupModelsRequest.url()).pathname).toBe(groupModelsPath);
    await expectParameterValue(quality, "max");
    await chooseParameterOption(quality, "low");
    await expect.poll(savedData).toMatchObject({ model: "gpt-image-2.5", qualityMode: "custom", parameters: { quality: "low" } });
    await page.getByRole("combobox", { name: "选择测试 模型", exact: false }).click();
    const modelOptions = page.getByRole("listbox", { name: "选择测试 模型 可选模型", exact: true });
    await expect(modelOptions).toContainText("ID: gpt-image-2");
    await expect(modelOptions).not.toContainText(/档位：|比例：|尺寸：|质量：/u);
    await expect(modelOptions.locator('[id$="-parameters"]')).toHaveCount(0);
    if (zoom === 1) await page.screenshot({ path: testInfo.outputPath("compact-model-menu-with-parameter-controls.png") });
    await page.getByRole("option", { name: "图像模型", exact: true }).click();
    await expectParameterValue(quality, "high");
    await expect.poll(savedData).toMatchObject({ model: "gpt-image-2", qualityMode: "highest", parameters: { quality: "high" } });
    await page.getByRole("combobox", { name: "选择测试 模型", exact: false }).click();
    await page.getByRole("option", { name: "另一图像模型", exact: true }).click();
    // First selection uses the model's highest quality; returning to a model
    // restores its own explicit choice, including the custom-quality mode.
    await expectParameterValue(quality, "low");
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
      .toMatchObject({ qualityMode: "custom", parameters: { quality: "low" } });
    // The unified route picker now uses ArrowDown to open its focused choices.
    // Escape restores its trigger; neither keyboard layer selects the node.
    await routeTrigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(routes).toBeVisible();
    await expect(routes.locator("[data-route-choice]").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(routes).toBeHidden();
    await expect(routeTrigger).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sidebar).toHaveAttribute("aria-expanded", selectionState!);
    await expect(
      page.locator('.react-flow__node[data-id="source"]'),
    ).not.toHaveClass(/selected/);
    await page.reload();
    if (zoom < .55) await setCanvasZoomWithWheel(page, 1);
    await page
      .getByRole("button", { name: "打开 选择测试 模型与参数", exact: true })
      .click();
    if (zoom < .55) await setCanvasZoomWithWheel(page, zoom);
    await expect(panel.getByLabel("当前线路", { exact: true })).toContainText(`供应商乙 ${zoom} › 标准`);
    await routeTrigger.click();
    await expect(routeChoice(connections[3]!.id)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expectParameterValue(quality, "low");
    await expect.poll(savedData).toMatchObject({ model: "gpt-image-2.5", qualityMode: "custom", parameters: { quality: "low" } });
    await page.getByRole("combobox", { name: "选择测试 模型", exact: false }).click();
    await page.getByRole("option", { name: "图像模型", exact: true }).click();
    await expectParameterValue(quality, "high");
    await expect.poll(savedData).toMatchObject({ model: "gpt-image-2", qualityMode: "highest", parameters: { quality: "high" } });
    await page.getByRole("combobox", { name: "选择测试 模型", exact: false }).click();
    await page.getByRole("option", { name: "另一图像模型", exact: true }).click();
    await expectParameterValue(quality, "low");
    await expect.poll(savedData).toMatchObject({ model: "gpt-image-2.5", qualityMode: "custom", parameters: { quality: "low" } });
    expect(submitted).toBe(0);
  });

test("同群组多连接保留身份，旧智能体 Key 的图片模型可选择且最近记录不串连接", async ({ page, request }) => {
  const models = Array.from({ length: 100 }, (_, index) => ({
    id: index ? `picker-image-${String(index).padStart(3, "0")}` : "gpt-image-2",
    name: `列表模型 ${String(index).padStart(3, "0")}`,
    operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
    metadata: { canvasRunnable: index !== 98, priceLabel: index === 38 ? "¥0.1/张 · 隔离测试：参考素材与最高质量条件下的完整展示报价" : "¥0.1/张", ...(index === 97 ? { imageCapabilitiesVerifiedAt: "2026-09-22" } : {}) },
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
  const routeTrigger = panel.getByRole("button", { name: "多连接测试 线路", exact: true });
  const routes = panel.getByRole("dialog", { name: "多连接测试 候选线路", exact: true });
  const routeChoice = (id: string) => routes.locator(`[data-route-id="${id}"] [data-route-choice]`);
  await routeTrigger.click();
  await expect(routeChoice(ids[2]!)).toHaveAttribute("aria-pressed", "true");
  await expect(routeChoice(ids[1]!)).toHaveAttribute("aria-disabled", "false");
  await expect(routeChoice(ids[3]!)).toHaveCount(0);
  await expect(routes.locator(`[data-route-id="${ids[1]}"]`)).toHaveAttribute("data-route-group", "共享群组");
  await expect(panel.getByText(/当前实际连接是 未配置账户/)).toBeVisible();
  expect((await savedData()).connectionId).toBe(ids[2]);
  await routeChoice(ids[1]!).click();
  await expect(routeTrigger).toHaveAttribute("aria-expanded", "false");
  const picker = panel.getByRole("combobox", { name: "多连接测试 模型", exact: false });
  await expect(picker).toContainText("列表模型 000");
  await picker.click();
  const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
  await expect(search).toBeFocused();
  const modelList = panel.getByRole("listbox");
  const mountedOptions = modelList.getByRole("option");
  // The page still represents 40 options, while the DOM contains only the
  // variable-height viewport, its overscan and the keyboard-active option.
  await expect.poll(() => mountedOptions.count()).toBeGreaterThan(0);
  await expect.poll(() => mountedOptions.count()).toBeLessThan(40);
  await expect(modelList.locator('[data-virtual-model-list]')).toHaveCount(1);
  await expect(panel.getByRole("option", { name: "列表模型 000", exact: true })).toHaveAttribute("aria-setsize", "101");
  await expect(panel.getByRole("option", { name: "列表模型 000", exact: true }).locator("svg.lucide-check")).toHaveCount(1);
  await modelList.hover();
  await page.mouse.wheel(0, 3000);
  const endOfPage = panel.getByRole("option", { name: "列表模型 038", exact: true });
  await expect(endOfPage).toBeInViewport();
  await expect(endOfPage).toHaveAttribute("aria-posinset", "40");
  // Compact prose keeps its complete text and title while the rendered price
  // stays within two lines and does not overlap its neighbour.
  const fullQuote = models[38]!.metadata.priceLabel;
  const compact = endOfPage.locator("[data-price-compact]");
  await expect(compact).toHaveAttribute("title", fullQuote);
  expect(await compact.textContent()).toBe(fullQuote);
  await expect(compact.locator("[data-price-part]")).not.toHaveCount(0);
  for (const part of await compact.locator("[data-price-part]").all()) {
    await expect(part).toHaveAttribute("title", (await part.textContent())!.trim());
    await expect(part).toHaveCSS("white-space", "nowrap");
    await expect(part).toHaveCSS("text-overflow", "ellipsis");
  }
  const rowGeometry = await endOfPage.evaluate(element => {
    const row = element.getBoundingClientRect();
    const priceElement = element.querySelector('[id$="-price"]')!;
    const price = priceElement.getBoundingClientRect();
    const previous = element.parentElement!.querySelector('[data-index="38"]')!.getBoundingClientRect();
    return { height: row.height, priceHeight: price.height, priceLineHeight: Number.parseFloat(getComputedStyle(priceElement).lineHeight), gap: row.top - previous.bottom,
      priceInside: price.left >= row.left && price.right <= row.right + 1 && price.top >= row.top && price.bottom <= row.bottom + 1 };
  });
  expect(rowGeometry.height).toBeGreaterThan(0);
  expect(rowGeometry.priceHeight).toBeLessThanOrEqual(rowGeometry.priceLineHeight * 2 + 1);
  expect(rowGeometry.gap).toBeGreaterThanOrEqual(-1);
  expect(rowGeometry.priceInside).toBe(true);
  await expect.poll(() => mountedOptions.count()).toBeLessThan(40);
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(panel.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
  await expect(search).toBeFocused();
  await search.press("End");
  await expect(panel.getByRole("option", { name: "列表模型 099", exact: true })).toBeInViewport();
  await expect(panel.getByRole("option", { name: "列表模型 099", exact: true })).toHaveAttribute("aria-posinset", "101");
  await expect.poll(async () => search.getAttribute("aria-activedescendant").then(id => page.locator(`[id="${id}"]`).count())).toBe(1);
  await search.press("Home");
  await expect(panel.getByRole("option", { name: "自动模型", exact: true })).toBeInViewport();
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
  await routeTrigger.click();
  await routeChoice(ids[0]!).click();
  await picker.click();
  await panel.getByLabel("模型状态筛选").selectOption("recent");
  await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(0);
  expect(submissions).toBe(0);
});

test("长目录暖开尺寸缓存随新报价与窄窗口重新测量", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const models = Array.from({ length: 32 }, (_, index) => ({
    id: `cache-image-${String(index).padStart(3, "0")}`, name: `缓存型号 ${String(index).padStart(3, "0")}`,
    operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
    metadata: { canvasRunnable: true, priceLabel: "¥0.1/张" },
  }));
  const selected = models[5]!;
  const createdProvider = await request.post("/api/providers", { data: {
    name: "窗口测量隔离回归", provider: "openai", apiKey: "isolated-no-generation",
    config: { baseUrl: "https://model-window-cache.invalid", preset: "cyberafei-api", usage: "canvas",
      modelGroup: "尺寸估计回归", defaultModel: selected.id },
  } });
  expect(createdProvider.ok()).toBeTruthy();
  const connection = await createdProvider.json();
  let scans = 0;
  await page.route(`**/api/providers/${connection.id}/models*`, route => {
    scans++;
    return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } });
  });
  let submissions = 0;
  await page.route("**/api/runs**", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  const createdCanvas = await request.post("/api/canvas", { data: { title: "窗口尺寸估计回归", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "cache-source", type: "workflow", position: { x: 110, y: 50 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label: "测量缓存", provider: "openai", connectionId: connection.id,
        model: selected.id, parts: [], parameters: {}, inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(createdCanvas.ok()).toBeTruthy();
  const canvas = await createdCanvas.json();
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "打开 测量缓存 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "测量缓存 模型与参数", exact: true });
  const picker = panel.getByRole("combobox", { name: "测量缓存 模型", exact: false });
  await expect(picker).toContainText(selected.name);
  const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
  const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
  const list = panel.getByRole("listbox");
  const row = list.getByRole("option", { name: selected.name, exact: true });
  await picker.click();
  await expect(row).toBeInViewport();
  await expect(row.locator("svg.lucide-check")).toHaveCount(1);
  const originalWidth = (await list.boundingBox())!.width;
  await search.press("Escape");
  // Reopen the same ModelPicker instance once to exercise its saved estimates.
  await picker.click();
  await expect(row).toBeInViewport();
  await search.press("Escape");
  const nextQuote = "¥0.2/张 · 最高质量与参考图片组合，透明输出单独核算，完整报价条件必须换行保留。".repeat(4);
  selected.metadata.priceLabel = nextQuote;
  const scansBeforeChange = scans;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => scans).toBeGreaterThan(scansBeforeChange);
  await expect(panel.getByTestId("param-panel-unit-price")).toContainText(nextQuote);
  await page.setViewportSize({ width: 390, height: 844 });
  for (let reopen = 0; reopen < 2; reopen++) {
    await picker.click();
    await expect(list.locator('[data-virtual-model-list]')).toHaveCount(1);
    await expect(row.locator('[id$="-price"]')).toHaveText(nextQuote);
    const compact = row.locator("[data-price-compact]");
    await expect(compact).toHaveAttribute("title", nextQuote);
    expect(await compact.textContent()).toBe(nextQuote);
    await expect(compact.locator("[data-price-part]")).not.toHaveCount(0);
    for (const part of await compact.locator("[data-price-part]").all()) {
      await expect(part).toHaveAttribute("title", (await part.textContent())!.trim());
      await expect(part).toHaveCSS("white-space", "nowrap");
      await expect(part).toHaveCSS("text-overflow", "ellipsis");
    }
    await expect(row.locator("svg.lucide-check")).toHaveCount(1);
    await expect.poll(() => list.getByRole("option").count()).toBeLessThan(33);
    await expect.poll(() => list.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(originalWidth - 20);
    await expect.poll(() => row.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const price = element.querySelector('[id$="-price"]')!.getBoundingClientRect();
      return price.left >= bounds.left - 1 && price.right <= bounds.right + 1
        && price.top >= bounds.top - 1 && price.bottom <= bounds.bottom + 1;
    })).toBe(true);
    const priceGeometry = await row.locator('[id$="-price"]').evaluate(element => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(priceGeometry.height).toBeGreaterThan(0);
    expect(priceGeometry.height).toBeLessThanOrEqual(priceGeometry.lineHeight * 2 + 1);
    await expect.poll(() => row.evaluate(element => {
      const next = element.parentElement!.querySelector('[data-index="7"]');
      return next ? next.getBoundingClientRect().top - element.getBoundingClientRect().bottom : -Infinity;
    })).toBeGreaterThanOrEqual(-1);
    const menu = panel.locator(".node-model-select-options");
    await expect.poll(() => menu.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 11 && bounds.right <= window.innerWidth - 11
        && bounds.top >= 11 && bounds.bottom <= window.innerHeight - 11;
    })).toBe(true);
    await search.press("End");
    const last = list.getByRole("option", { name: models.at(-1)!.name, exact: true });
    await expect(last).toBeInViewport();
    await expect(last).toHaveAttribute("aria-posinset", "33");
    await search.press("Escape");
    await expect(picker).toBeFocused();
  }
  await picker.click();
  await page.screenshot({ path: testInfo.outputPath("window-cache-updated-price-mobile.png") });
  expect(submissions).toBe(0);
  const saved = await (await request.get(`/api/canvas/${canvas.id}`)).json();
  expect(saved.graph.nodes[0].data).toMatchObject({ connectionId: connection.id, model: selected.id });
});
