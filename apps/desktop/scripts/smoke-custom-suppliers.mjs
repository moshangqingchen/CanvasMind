import assert from "node:assert/strict";

/** Exercise managed supplier identity through the real packaged API and canvas UI. */
export async function smokeCustomSuppliers(page, api, origin) {
  const modelLabels = {
    "gpt-image-2": "GPT Image 2",
    "gpt-image-2.5": "GPT Image 2.5",
    "gpt-image-2.5-flare": "GPT Image 2.5 Flare",
    "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
  };
  const models = ["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].map((id, index) => ({
    id, name: id, isDefault: index === 0,
    operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image"], outputKinds: ["image"],
    metadata: { canvasRunnable: true },
  }));
  const fixtures = [];
  for (const [name, group] of [["智元api", "GPT Pro"], ["怪兽ai", "B3-GPT生图-特惠渠道"]]) {
    const supplier = await api("/api/suppliers", {
      name, siteUrl: "https://supplier-smoke.invalid", apiUrl: "https://supplier-smoke.invalid",
    });
    const connection = await api("/api/providers", {
      name: `${name} · ${group} · 画布`, provider: "openai", apiKey: "offline-supplier-smoke",
      config: {
        supplierId: supplier.id, supplierKey: supplier.supplierKey,
        baseUrl: supplier.apiUrl, usage: "canvas", customGroup: true, modelGroup: group, defaultModel: models[0].id,
      },
    });
    assert.equal(connection.config.supplierName, name);
    await page.route(`**/api/providers/${connection.id}/models*`, (route) => route.fulfill({
      json: models, headers: { "X-Model-Scan-Status": "live" },
    }));
    fixtures.push({ supplier, connection, group });
  }
  const monster = fixtures[1];
  const canvas = await api("/api/canvas", {
    title: "自定义供应商选择验收", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [],
      nodes: [{ id: "supplier-image", type: "workflow", position: { x: 180, y: 70 }, data: {
        nodeType: "image-generation", label: "供应商验收", provider: "fake", connectionId: "fake-default",
        model: "fake-image-v1", inputs: [{ id: "prompt", kind: "text", label: "Prompt" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }], parameters: {},
      } }],
    },
  });
  await page.goto(`${origin}/canvas/${canvas.id}`);
  const open = () => page.getByRole("button", { name: /打开 供应商验收 模型与参数/u }).click();
  await open();
  const panel = page.getByRole("dialog", { name: "供应商验收 模型与参数", exact: true });
  const routeTrigger = panel.getByRole("button", { name: "供应商验收 线路", exact: true });
  const routes = panel.getByRole("dialog", { name: "供应商验收 候选线路", exact: true });
  const supplierHeading = (name) => routes.getByRole("heading", { name, exact: true });
  const routeRow = (connection) => routes.locator(`[data-route-id="${connection.id}"]`);
  const openRoutes = async () => { await routeTrigger.click(); await routes.waitFor({ state: "visible" }); };
  const closeRoutes = async () => { await page.keyboard.press("Escape"); await routes.waitFor({ state: "hidden" }); };
  await openRoutes();
  await supplierHeading("怪兽ai").waitFor({ state: "visible" });
  assert.equal(await supplierHeading("智元api").count(), 1);
  assert.equal(await supplierHeading("怪兽ai").count(), 1);
  assert.equal(await routes.getByRole("heading").filter({ hasText: /custom-/u }).count(), 0);
  await closeRoutes();
  // Use the real route popup: API writes or programmatic selection would miss
  // clicks bubbling through this portal into the owning canvas node.
  await page.locator(".react-flow__pane").click({ position: { x: 15, y: 90 } });
  await openRoutes();
  assert.equal(await page.locator('.react-flow__node[data-id="supplier-image"]')
    .evaluate((element) => element.classList.contains("selected")), false);
  const monsterRow = routeRow(monster.connection);
  assert.equal(await monsterRow.getAttribute("data-route-group"), monster.group);
  await monsterRow.locator("[data-route-choice]").click();
  assert.equal(await routeTrigger.getAttribute("aria-expanded"), "false");
  assert.ok((await panel.getByLabel("当前线路", { exact: true }).textContent()).includes(monster.group));
  await panel.getByRole("combobox", { name: /^供应商验收 模型(?: ·|$)/u }).click();
  for (const model of models) {
    const option = panel.getByRole("option", { name: modelLabels[model.id], exact: true });
    await option.waitFor({ state: "visible" });
    assert.equal(await option.isEnabled(), true);
  }
  await panel.getByRole("option", { name: "GPT Image 2.5", exact: true }).click();
  await page.getByRole("button", { name: "画布自动保存状态" }).filter({ hasText: "已保存" }).waitFor();
  const saved = await api(`/api/canvas/${canvas.id}`);
  assert.equal(saved.graph.nodes[0].data.connectionId, monster.connection.id);
  assert.equal(saved.graph.nodes[0].data.model, "gpt-image-2.5");
  const currentSupplier = (await api("/api/suppliers")).find((item) => item.id === monster.supplier.id);
  await api(`/api/suppliers/${monster.supplier.id}`, { name: "怪兽设计", expectedRevision: currentSupplier.state.revision }, "PATCH");
  await page.reload();
  await open();
  await openRoutes();
  await supplierHeading("怪兽设计").waitFor({ state: "visible" });
  assert.equal(await supplierHeading("怪兽设计").count(), 1);
  assert.equal(await routeRow(monster.connection).locator("[data-route-choice]").getAttribute("aria-pressed"), "true");
  await closeRoutes();
  assert.ok((await panel.getByLabel("当前线路", { exact: true }).textContent()).includes("怪兽设计"));
  assert.equal(await panel.getByTestId("param-panel-unit-price").textContent(), "—");
  await panel.getByRole("button", { name: "账号余额与消耗", exact: true }).click();
  const billing = panel.getByLabel("供应商余额与消耗", { exact: true });
  assert.equal(await billing.locator("span").filter({ hasText: /^余额\s*未读取$/u }).count(), 1);
  await openRoutes();
  for (const fixture of fixtures) {
    const name = fixture === monster ? "怪兽设计" : "智元api";
    assert.equal(await supplierHeading(name).isVisible(), true);
    const row = routeRow(fixture.connection);
    assert.equal(await row.getAttribute("data-route-group"), fixture.group);
    assert.equal(await row.getByLabel("同型号报价", { exact: true }).textContent(), "—");
    assert.equal(await row.locator("[data-route-choice] small").first().textContent(), "余额未读取");
  }
  assert.ok(await routes.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.ok(await routes.getByRole("list", { name: "候选线路", exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.equal(await routeRow(monster.connection).locator("[data-route-choice]").getAttribute("aria-pressed"), "true");
  await closeRoutes();
  await page.goto(origin);
  await page.getByRole("button", { name: "创作设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  await settings.getByRole("button").filter({ has: page.locator("strong", { hasText: "怪兽设计" }) }).click();
  await settings.locator("summary").filter({ hasText: "账号账务与生成方式" }).click();
  const cloudChoice = settings.getByRole("checkbox", { name: "使用 Cloudflare 云端生图" });
  assert.equal(await cloudChoice.isChecked(), false);
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/api/suppliers/${monster.supplier.id}`) && response.request().method() === "PATCH"),
    cloudChoice.click(),
  ]);
  await page.waitForFunction(() => document.querySelector('[aria-label="使用 Cloudflare 云端生图"]')?.checked === true);
  const transportSuppliers = await api("/api/suppliers");
  assert.equal(transportSuppliers.find(item => item.id === monster.supplier.id).state.generationTransport, "cloudflare");
  assert.notEqual(transportSuppliers.find(item => item.id === fixtures[0].supplier.id).state.generationTransport, "cloudflare");
  await settings.getByRole("tab", { name: "云端生图", exact: true }).click();
  await settings.getByRole("heading", { name: "Cloudflare 云端生图" }).waitFor();
  assert.equal(await settings.getByLabel("云端服务访问密钥").getAttribute("type"), "password");
  await settings.getByRole("button", { name: "关闭设置" }).click();
  // This check never submits a generation, and its credentials/profile are isolated.
}
