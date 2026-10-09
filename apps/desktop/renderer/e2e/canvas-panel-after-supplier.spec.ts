import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";

const models = ["甲", "乙"].map((suffix, index) => ({
  id: `gpt-image-panel-${index}`,
  name: `交互回归图像模型${suffix}`,
  operations: ["image.generate"],
  inputKinds: ["text"],
  outputKinds: ["image"],
  metadata: { canvasRunnable: true },
  // Enough genuine descriptor controls to require scrolling the panel body.
  parameters: Array.from({ length: 12 }, (_, parameter) => ({
    key: `panel_parameter_${parameter}`,
    label: `交互参数 ${parameter + 1}`,
    control: "select",
    valueType: "string",
    default: "first",
    options: [
      { value: "first", label: "第一档" },
      { value: "second", label: "第二档" },
    ],
  })),
}));

async function chooseNativeWithMouse(page: Page, select: Locator, value: string) {
  await select.click();
  await expect
    .poll(() => select.evaluate((element) => element.matches(":open")))
    .toBe(true);
  const index = await select.locator("option").evaluateAll(
    (options, target) =>
      options.findIndex((option) => (option as HTMLOptionElement).value === target),
    value,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Home");
  for (let item = 0; item < index; item++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue(value);
  await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(false);
}

async function clickExposedControl(control: Locator) {
  const position = await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (const x of [12, bounds.width / 2, bounds.width - 12]) {
      for (const y of [bounds.height / 2, 12, bounds.height - 12]) {
        const hit = document.elementFromPoint(bounds.left + x, bounds.top + y);
        if (hit && element.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  expect(position, "the control must have an exposed clickable area").not.toBeNull();
  await control.click({ position: position! });
}

async function wheelPanel(page: Page, panel: Locator, delta: number) {
  const body = panel.locator(".node-config-popover-body");
  const target = await body.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const left = Math.max(bounds.left + 8, 1);
    const right = Math.min(bounds.right - 24, innerWidth - 1);
    const top = Math.max(bounds.top + 8, 1);
    const bottom = Math.min(bounds.bottom - 8, innerHeight - 1);
    if (right <= left || bottom <= top) return { point: null, reason: "body outside viewport" };
    // Hit-test the visible body, including its padding, so an overlapping
    // attached panel cannot silently receive the intended panel's wheel.
    for (const x of [right, left, (left + right) / 2]) {
      for (const y of [(top + bottom) / 2, top, bottom]) {
        const hit = document.elementFromPoint(x, y);
        if (hit && element.contains(hit)) return { point: { x, y }, reason: "body hit" };
      }
    }
    return { point: null, reason: "body covered by another surface" };
  });
  expect(target.point, target.reason).not.toBeNull();
  await page.mouse.move(target.point!.x, target.point!.y);
  await page.mouse.wheel(0, delta);
  return body;
}

async function fixture(page: Page, request: APIRequestContext, suffix: string) {
  await page.setViewportSize({ width: 1440, height: 1080 });
  let submissions = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/runs**", async (route) => {
    // Block every possible paid submission, including an accidental Run click.
    if (route.request().method() === "POST") {
      submissions++;
      await route.abort();
    } else await route.continue();
  });
  let scans = 0;
  const completedScans = new Map<string, number>();
  let holdScan = false;
  const pendingScans = new Set<() => void>();
  await page.route("**/api/providers/*/models*", async (route) => {
    scans++;
    if (holdScan) {
      await new Promise<void>((resolve) => pendingScans.add(resolve));
    }
    await route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } });
    const connectionId = new URL(route.request().url()).pathname.split("/")[3]!;
    completedScans.set(connectionId, (completedScans.get(connectionId) ?? 0) + 1);
  });
  const mainGroup = `${suffix} 高质量`;
  const alternateGroup = `${suffix} 标准`;
  async function createSupplier(name: string, supplierKey?: string) {
    const response = await request.post("/api/suppliers", {
      data: { name, siteUrl: "https://panel-after-supplier.invalid", apiUrl: "https://panel-after-supplier.invalid", ...(supplierKey ? { supplierKey } : {}) },
    });
    expect(response.ok()).toBeTruthy();
    const supplier = await response.json();
    const connections: string[] = [];
    for (const group of [mainGroup, alternateGroup]) {
      const response = await request.post("/api/providers", { data: {
        name: `${name} · ${group}`,
        provider: "openai",
        apiKey: "isolated-panel-after-supplier-key",
        config: {
          supplierId: supplier.id,
          supplierKey: supplier.supplierKey,
          baseUrl: supplier.apiUrl,
          usage: "canvas",
          customGroup: true,
          modelGroup: group,
          defaultModel: models[0]!.id,
          modelCatalogModels: models,
          modelScanStatus: "live",
        },
      } });
      expect(response.ok()).toBeTruthy();
      connections.push((await response.json()).id);
    }
    return { ...supplier, connections };
  }
  const original = await createSupplier(`原供应商 ${suffix}`);
  const labels = [`左侧 ${suffix}`, `右侧 ${suffix}`];
  const response = await request.post("/api/canvas", { data: {
    title: `新增供应商参数面板回归 ${suffix}`,
    graph: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      edges: [],
      nodes: labels.map((label, index) => ({
        id: `panel-${index}`,
        type: "workflow",
        position: { x: 55 + index * 500, y: 50 },
        style: { width: 420, height: 180 },
        data: {
          nodeType: "image-generation",
          label,
          provider: "openai",
          connectionId: original.connections[0],
          model: models[0]!.id,
          parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          outputs: [{ id: "images", kind: "image", label: "图片" }],
          parameters: {},
        },
      })),
    },
  } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  await page.goto(`/canvas/${canvas.id}`);
  const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
  if ((await sidebar.getAttribute("aria-expanded")) === "true") await sidebar.click();
  const panels = [];
  for (const label of labels) {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
    await expect(panel).toBeVisible();
    panels.push({
      panel,
      supplier: panel.getByRole("combobox", { name: `${label} 供应商`, exact: true }),
      group: panel.getByRole("combobox", { name: `${label} 模型群组`, exact: true }),
      model: panel.getByRole("combobox", { name: `${label} 模型`, exact: true }),
    });
  }
  return {
    panels,
    labels,
    createSupplier,
    mainGroup,
    alternateGroup,
    scans: () => scans,
    completedScans: (connectionId: string) => completedScans.get(connectionId) ?? 0,
    holdScans: () => { holdScan = true; },
    releaseScans: () => {
      holdScan = false;
      for (const resume of pendingScans) resume();
      pendingScans.clear();
    },
    assertNoRuns: () => {
      expect(submissions).toBe(0);
      expect(pageErrors).toEqual([]);
    },
  };
}

test("新增供应商并关闭设置后，两个参数面板的下拉、模型菜单和滚轮保持可用", async ({ page, request }) => {
  const ui = await fixture(page, request, "供应商添加");
  await page.getByRole("button", { name: "API 设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  await expect(settings).toBeVisible();
  // Use the real save APIs inside the isolated test database. Closing settings
  // follows the same connections refresh as a supplier created in its form.
  const added = await ui.createSupplier("新添加交互供应商", "cyberafei");
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(settings).toBeHidden();
  for (const panel of ui.panels) {
    await expect(panel.panel).toBeVisible();
    await expect(panel.supplier.locator('option[value="cyberafei"]')).toHaveCount(1);
    await chooseNativeWithMouse(page, panel.supplier, added.supplierKey);
    await chooseNativeWithMouse(page, panel.group, ui.alternateGroup);
    await panel.model.click();
    await expect(panel.model).toHaveAttribute("aria-expanded", "true");
    await panel.panel.getByRole("option", { name: models[1]!.name, exact: true }).click();
    await expect(panel.model).toContainText(models[1]!.id);
    const body = await wheelPanel(page, panel.panel, 700);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await wheelPanel(page, panel.panel, -2_000);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
  }
  const active = ui.panels[1]!;
  const beforeRefresh = ui.scans();
  const beforeCompletedRefresh = ui.completedScans(added.connections[1]);
  const beforeViewport = await page.locator(".react-flow__viewport").getAttribute("style");
  ui.holdScans();
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(ui.scans).toBeGreaterThan(beforeRefresh);
    await active.model.click();
    await expect(active.panel.getByRole("listbox")).toBeVisible();
    // A different panel remains clickable while its neighbor's list is open.
    await chooseNativeWithMouse(page, ui.panels[0]!.group, ui.mainGroup);
    await active.model.click();
    await expect(active.model).toHaveAttribute("aria-expanded", "true");
    ui.releaseScans();
    await expect.poll(() => ui.completedScans(added.connections[1])).toBeGreaterThan(beforeCompletedRefresh);
    await expect(active.panel.getByRole("option", { name: models[0]!.name, exact: true })).toBeVisible();
    await expect(active.model).toHaveAttribute("aria-expanded", "true");
    await active.panel.getByRole("option", { name: models[0]!.name, exact: true }).click();
    const body = await wheelPanel(page, active.panel, 700);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator(".react-flow__viewport")).toHaveAttribute("style", beforeViewport!);
  } finally {
    ui.releaseScans();
  }
  ui.assertNoRuns();
});

test("视频供应商比较与切换选择完整型号所在分组，不借用相似型号或图片价格", async ({ page, request }, info) => {
  const exactId = "doubao-seedance-cross-group-fast-fixture";
  const alternateId = exactId + "-preview";
  const video = (id: string, amount: number): ModelDescriptor => ({
    id, name: id, operations: ["video.generate"], inputKinds: ["text"], outputKinds: ["video"],
    metadata: { canvasRunnable: true }, pricing: { kind: "per-request", currency: "CNY", billingUnit: "request", unitAmount: amount, confidence: "exact", checkedAt: "2026-10-08T00:00:00Z" },
    parameters: [
      { key: "duration", label: "时长（秒）", control: "number", valueType: "number", default: 5, min: 1, max: 10 },
      { key: "ratio", label: "画面比例", control: "select", valueType: "string", default: "1280:720", options: [{ value: "1280:720", label: "16:9" }] },
      { key: "n", label: "数量", control: "number", valueType: "number", default: 1, min: 1, max: 1 },
    ],
  });
  const catalogs = new Map<string, ReturnType<typeof video>[]>();
  let submissions = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/runs**", route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route("**/api/providers/*/models*", route => {
    const id = new URL(route.request().url()).pathname.split("/")[3]!;
    return route.fulfill({ json: catalogs.get(id) ?? [], headers: { "X-Model-Scan-Status": "live" } });
  });
  await page.route(/\/api\/providers(?:\?.*)?$/u, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const rows = await response.json();
    // Catalog facts are server-owned; POST correctly rejects client scan flags.
    // Model an already completed free scan in each fixture group's GET view.
    await route.fulfill({ response, json: rows.map((row: { id: string; config: Record<string, unknown> }) => {
      const catalog = catalogs.get(row.id);
      return catalog ? { ...row, config: { ...row.config, modelCatalogModels: catalog, scannedModelIds: catalog.map(model => model.id),
        modelScanStatus: "live", modelScanAttemptStatus: "live", modelScanComplete: true, modelCatalogSource: "live",
        modelScanCheckedAt: "2026-10-08T00:00:00Z", modelScanLastSuccessAt: "2026-10-08T00:00:00Z" } } : row;
    }) });
  });
  async function supplier(name: string) {
    const response = await request.post("/api/suppliers", { data: { name, siteUrl: "https://cross-group-fixture.invalid", apiUrl: "https://cross-group-fixture.invalid" } });
    expect(response.ok()).toBeTruthy(); return response.json();
  }
  async function connection(owner: { id: string; name: string; supplierKey: string }, group: string, catalog: ReturnType<typeof video>[]) {
    const response = await request.post("/api/providers", { data: {
      name: `${owner.name} · ${group}`, provider: "rest", apiKey: "isolated-cross-group-fixture-key",
      config: { supplierId: owner.id, supplierKey: owner.supplierKey, baseUrl: "https://cross-group-fixture.invalid", usage: "canvas",
        customGroup: true, modelGroup: group, defaultModel: catalog[0]!.id },
    } });
    expect(response.ok()).toBeTruthy(); const result = await response.json(); catalogs.set(result.id, catalog); return result;
  }
  const original = await supplier("跨组原视频供应商");
  const originalConnection = await connection(original, "当前视频", [video(exactId, 1)]);
  const target = await supplier("跨组目标视频供应商");
  await connection(target, "flow", [video(alternateId, 0.01)]);
  // The same ID with image output must not outrank a video-compatible group.
  await connection(target, "同名图片与其他视频", [
    { ...video(exactId, 0.02), operations: ["image.generate"], outputKinds: ["image"] }, video(alternateId, 0.01),
  ]);
  const targetConnection = await connection(target, "seedance-官方token版", [video(exactId, 2)]);
  const missing = await supplier("跨组无完整型号供应商");
  await connection(missing, "同名图片与相似视频", [
    { ...video(exactId, 0.02), operations: ["image.generate"], outputKinds: ["image"] }, video(alternateId, 0.03),
  ]);
  const label = "跨组视频回归";
  const created = await request.post("/api/canvas", { data: { title: label, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [],
    nodes: [{ id: "cross-group-video", type: "workflow", position: { x: 60, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: "video-generation", label, provider: "rest", connectionId: originalConnection.id, model: exactId, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "video", kind: "video", label: "视频" }], parameters: {} } }],
  } } });
  expect(created.ok()).toBeTruthy(); const canvas = await created.json();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const suppliers = panel.getByRole("combobox", { name: `${label} 供应商`, exact: true });
  const group = panel.getByRole("combobox", { name: `${label} 模型群组`, exact: true });
  await expect(group).toHaveValue("当前视频");
  await expect(suppliers.locator(`option[value="${target.supplierKey}"]`)).toContainText("同型号 2 CNY / 次");
  await expect(suppliers.locator(`option[value="${missing.supplierKey}"]`)).toContainText("当前分组无此型号");
  await chooseNativeWithMouse(page, suppliers, target.supplierKey);
  await expect(group).toHaveValue("seedance-官方token版");
  await expect(panel.getByRole("combobox", { name: `${label} 模型`, exact: true })).toContainText(exactId);
  await expect(panel.getByLabel("当前供应商报价", { exact: true })).toContainText("2 CNY / 次");
  await expect.poll(async () => {
    const saved = await (await request.get(`/api/canvas/${canvas.id}`)).json();
    return saved.graph.nodes.find((node: { id: string }) => node.id === "cross-group-video").data;
  }).toMatchObject({ connectionId: targetConnection.id, model: exactId });
  await page.screenshot({ path: info.outputPath("supplier-exact-video-group.png") });
  // The same selected group can publish token billing instead of a flat task
  // price. Preserve the reference-video condition in the compact canvas UI.
  const tokenModel = video(exactId, 2);
  tokenModel.parameters = [...(tokenModel.parameters ?? []), { key: "resolution", label: "分辨率", control: "select", valueType: "string", default: "720p",
    options: [{ value: "720p", label: "720p" }] }];
  tokenModel.pricing = { kind: "token", currency: "CNY", confidence: "exact", checkedAt: "2026-10-08T00:00:00Z",
    sourceUrl: "https://token.secure-skill.com/api/v1/pricing/channels",
    tiers: [false, true].map(reference => ({ id: String(reference), label: reference ? "含参考视频" : "不含参考视频",
      price: reference ? 18.2 : 29, conditionMode: "all", conditions: [
        { parameter: "token_kind", operator: "equals", value: "output" },
        { parameter: "resolution", operator: "equals", value: "720p" },
        { parameter: "has_reference_video", operator: "equals", value: String(reference) },
      ] })) };
  catalogs.set(targetConnection.id, [tokenModel]);
  await page.reload();
  await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
  await expect(group).toHaveValue("seedance-官方token版");
  const tokenQuote = panel.getByLabel("当前供应商报价", { exact: true });
  await expect(tokenQuote).toContainText("输出 ¥18.2–29/1M tokens（参考视频条件未确认）");
  await expect(tokenQuote).not.toContainText("2 CNY / 次");
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  await page.screenshot({ path: info.outputPath("supplier-token-conditional-price.png") });
  expect(submissions).toBe(0); expect(errors).toEqual([]);
});

for (const interruption of ["pointercancel", "blur", "capture-lost-blur"] as const)
test(`框选被 ${interruption} 中断后移除遮挡，参数面板仍能下拉和滚动`, async ({ page, request }, testInfo) => {
  const ui = await fixture(page, request, `框选取消 ${interruption}`);
  const first = ui.panels[0]!;
  const pane = page.locator(".react-flow__pane");
  const paneBounds = await pane.boundingBox();
  const supplierBounds = await first.supplier.boundingBox();
  const bodyBounds = await first.panel.locator(".node-config-popover-body").boundingBox();
  const viewport = page.locator(".react-flow__viewport");
  const beforeGestureViewport = await viewport.getAttribute("style");
  expect(paneBounds).not.toBeNull();
  expect(supplierBounds).not.toBeNull();
  expect(bodyBounds).not.toBeNull();
  // Capture the browser's actual mouse pointer ID instead of assuming 1.
  await pane.evaluate((element) => {
    const events: { type: string; trusted: boolean; captured: boolean }[] = [];
    const record = (event: Event) => {
      events.push({
        type: event.type,
        trusted: event.isTrusted,
        captured: element.hasPointerCapture(Number(element.getAttribute("data-test-pointer-id"))),
      });
      element.setAttribute("data-test-interruption-events", JSON.stringify(events));
      if (event.type === "blur") element.setAttribute("data-test-blur-trusted", String(event.isTrusted));
    };
    element.addEventListener("pointerdown", (event) => {
      element.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId));
      record(event);
    }, { once: true });
    element.addEventListener("lostpointercapture", record);
    element.addEventListener("pointercancel", record);
    // Capture before the app's blur recovery forwards pointercancel, preserving
    // the browser's original capture state and the real event ordering.
    // A capture listener on window also sees descendant controls losing focus.
    // Only the window's own blur is the interruption being exercised here.
    window.addEventListener("blur", (event) => {
      if (event.target === window) record(event);
    }, { capture: true });
  });
  const marqueeStart = { x: paneBounds!.x + paneBounds!.width - 100, y: paneBounds!.y + 20 };
  // Start above the cards. A start inside the right card captures its child
  // instead of the pane and its stopped propagation bypasses our recorder.
  expect(await pane.evaluate((element, point) =>
    document.elementFromPoint(point.x, point.y) === element,
    marqueeStart,
  )).toBe(true);
  await page.keyboard.down("Control");
  await page.mouse.move(marqueeStart.x, marqueeStart.y);
  await page.mouse.down();
  try {
    const selectionEndX = interruption !== "pointercancel"
      // React Flow's edge zone is 40px. Use its slowest real auto-pan speed
      // so capture assertions cannot push both panels into the same edge clamp.
      ? paneBounds!.x + 39
      : supplierBounds!.x - 15;
    await page.mouse.move(selectionEndX, bodyBounds!.y + bodyBounds!.height - 30, { steps: 12 });
    await expect(page.locator(".react-flow__selection")).toBeVisible();
    if (interruption !== "pointercancel") {
      // Begin real auto-panning at the canvas edge before losing focus. State
      // cleanup must also stop the library's animation loop while the pointer
      // remains at the edge; simply hiding its rectangle would leave it moving.
      await expect.poll(() => viewport.getAttribute("style")).not.toBe(beforeGestureViewport);
    }
    if (interruption === "pointercancel") {
      await pane.evaluate((element) => {
        element.dispatchEvent(new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: Number(element.getAttribute("data-test-pointer-id")),
          pointerType: "mouse",
          isPrimary: true,
        }));
      });
    } else if (interruption === "blur") {
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    } else {
      // Lose real browser pointer capture before focus recovery, while the
      // physical mouse stays down at the edge and auto-pan is still running.
      await expect.poll(() => pane.evaluate((element) =>
        element.hasPointerCapture(Number(element.getAttribute("data-test-pointer-id"))),
      )).toBe(true);
      await pane.evaluate((element) => {
        element.releasePointerCapture(Number(element.getAttribute("data-test-pointer-id")));
      });
      await expect.poll(() => pane.evaluate((element) =>
        element.hasPointerCapture(Number(element.getAttribute("data-test-pointer-id"))),
      )).toBe(false);
      // A native pointer event flushes the browser's pending capture release.
      await page.mouse.move(selectionEndX, bodyBounds!.y + bodyBounds!.height - 30);
      await expect.poll(() => pane.evaluate((element) => {
        const events = JSON.parse(element.getAttribute("data-test-interruption-events") ?? "[]") as { type: string; trusted: boolean }[];
        return events.some((event) => event.type === "lostpointercapture" && event.trusted);
      })).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      const events = JSON.parse(await pane.getAttribute("data-test-interruption-events") ?? "[]") as { type: string; trusted: boolean; captured: boolean }[];
      await testInfo.attach("capture-loss-before-blur-event-order", {
        body: JSON.stringify(events),
        contentType: "application/json",
      });
      expect(events.find((event) => event.type === "blur")?.captured).toBe(false);
      expect(events.findIndex((event) => event.type === "lostpointercapture")).toBeLessThan(events.findIndex((event) => event.type === "blur"));
    }
    // Cancellation must clean up immediately. A later pointerup is not
    // guaranteed when the OS cancels a pointer or focus moves to another app.
    await expect(page.locator(".react-flow__selection")).toHaveCount(0);
    if (interruption !== "pointercancel") {
      const stoppedTransforms = await viewport.evaluate(async (element) => {
        const transforms: string[] = [];
        for (let frame = 0; frame < 4; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          transforms.push(getComputedStyle(element).transform);
        }
        return transforms.slice(1);
      });
      expect(new Set(stoppedTransforms).size).toBe(1);
    }
  } finally {
    // A cancelled capture releases the pointer. Releasing outside the pane
    // must not rely on a later pane pointerup to repair the cancelled gesture.
    await page.mouse.move(20, 20);
    await page.mouse.up();
    if (interruption !== "pointercancel") await page.keyboard.up("Control");
  }
  await expect(page.locator(".react-flow__selection")).toHaveCount(0);
  // The first field action must work without a native select's pointerup
  // incidentally cleaning up the cancelled gesture. Keep Ctrl down in the
  // pointercancel case to also exercise the pane's selection capture handler.
  try {
    await clickExposedControl(first.model);
    await expect(first.model).toHaveAttribute("aria-expanded", "true");
    await clickExposedControl(first.panel.getByRole("option", { name: models[1]!.name, exact: true }));
    await expect(first.model).toContainText(models[1]!.id);
  } finally {
    await page.keyboard.up("Control");
  }
  // Marquee-selected nodes open the assistant rail and narrow the canvas,
  // making the two attached panels overlap after auto-pan. Restore the
  // fixture's layout only after the first model action has proved recovery.
  const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
  if ((await sidebar.getAttribute("aria-expanded")) === "true") await sidebar.click();
  await chooseNativeWithMouse(page, first.group, ui.alternateGroup);
  const neighboringBody = ui.panels[1]!.panel.locator(".node-config-popover-body");
  const neighboringScroll = await neighboringBody.evaluate((element) => element.scrollTop);
  const body = await wheelPanel(page, first.panel, 700);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => neighboringBody.evaluate((element) => element.scrollTop)).toBe(neighboringScroll);
  await wheelPanel(page, first.panel, -2_000);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
  ui.assertNoRuns();
});
