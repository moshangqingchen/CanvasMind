import assert from "node:assert/strict";

/** Exercise managed supplier identity through the real packaged API and canvas UI. */
export async function smokeCustomSuppliers(page, api, origin) {
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
  const panel = page.getByRole("dialog", { name: "供应商验收 模型与参数" });
  const select = panel.getByLabel("供应商验收 供应商", { exact: true });
  await select.locator("option", { hasText: "怪兽ai" }).waitFor({ state: "attached" });
  assert.equal(await select.locator("option", { hasText: "智元api" }).count(), 1);
  assert.equal(await select.locator("option", { hasText: "怪兽ai" }).count(), 1);
  assert.equal(await select.locator("option", { hasText: /custom-/u }).count(), 0);
  // A programmatic selectOption bypasses the actual native popup and missed
  // clicks bubbling from this portal into the owning canvas node.
  await page.locator(".react-flow__pane").click({ position: { x: 15, y: 90 } });
  await select.click();
  assert.equal(await select.evaluate((element) => element.matches(":open")), true);
  assert.equal(await page.locator('.react-flow__node[data-id="supplier-image"]')
    .evaluate((element) => element.classList.contains("selected")), false);
  const monsterIndex = await select.locator("option").evaluateAll(
    (options, key) => options.findIndex((option) => option.value === key), monster.supplier.supplierKey,
  );
  assert.ok(monsterIndex >= 0);
  await page.keyboard.press("Home");
  for (let index = 0; index < monsterIndex; index++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await panel.getByLabel("供应商验收 模型群组").inputValue(), monster.group);
  await panel.getByRole("combobox", { name: "供应商验收 模型", exact: true }).click();
  for (const model of models) {
    const option = panel.getByRole("option", { name: model.id, exact: true });
    await option.waitFor({ state: "visible" });
    assert.equal(await option.isEnabled(), true);
  }
  await panel.getByRole("option", { name: "gpt-image-2.5", exact: true }).click();
  await page.getByRole("button", { name: "画布自动保存状态" }).filter({ hasText: "已保存" }).waitFor();
  const saved = await api(`/api/canvas/${canvas.id}`);
  assert.equal(saved.graph.nodes[0].data.connectionId, monster.connection.id);
  assert.equal(saved.graph.nodes[0].data.model, "gpt-image-2.5");
  const currentSupplier = (await api("/api/suppliers")).find((item) => item.id === monster.supplier.id);
  await api(`/api/suppliers/${monster.supplier.id}`, { name: "怪兽设计", expectedRevision: currentSupplier.state.revision }, "PATCH");
  await page.reload();
  await open();
  await select.locator("option", { hasText: "怪兽设计" }).waitFor({ state: "attached" });
  assert.match(await select.locator("option:checked").textContent(), /^怪兽设计 · .* · 余额未读取$/u);
  assert.equal(await select.inputValue(), monster.supplier.supplierKey);
  await page.goto(origin);
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  await settings.getByRole("button").filter({ has: page.locator("strong", { hasText: "怪兽设计" }) }).click();
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
