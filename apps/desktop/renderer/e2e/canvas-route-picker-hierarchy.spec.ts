import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";

const before = process.env.ROUTE_HIERARCHY_PHASE === "before";
const evidence = process.env.ROUTE_HIERARCHY_SCREENSHOTS
  ?? "D:/project development/超级画布/.codex-logs/2026-10-19-route-hierarchy/screenshots";
const label = "线路层级";
const timestamp = "2026-10-19T08:00:00.000Z";
const longQuote = "0.123456 CNY / 张 · 最高质量及参考素材条件下的完整报价";
const longGroup = "超长分组名称用于验证两行展示与窄屏报价换行且不遮挡价格和当前线路标记";
const image: ModelDescriptor = {
  id: "hierarchy-image", name: "层级验收图片模型", operations: ["image.generate"],
  inputKinds: ["text"], outputKinds: ["image"], metadata: { canvasRunnable: true },
  pricing: { kind: "per-image", currency: "CNY", unitAmount: .4, confidence: "exact", checkedAt: timestamp },
};

async function fixture(page: Page, request: APIRequestContext, currentId = "equal-name", longList = false) {
  expect(process.env.PLAYWRIGHT_BASE_URL, "仅使用本地隔离运行时").toBeFalsy();
  const prohibited: string[] = [], errors: string[] = [], writes: Record<string, unknown>[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["data:", "blob:", "about:"].includes(url.protocol)) return route.fallback();
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      prohibited.push(`external ${url.hostname}`); return route.abort();
    }
    return route.fallback();
  });
  const connection = (id: string, name: string, group: string, options: {
    beta?: boolean; account?: string; display?: string; models?: ModelDescriptor[]; unavailable?: boolean;
  } = {}): ProviderConnectionView => {
    const models = options.models ?? [image];
    return { id, name, provider: options.display ? "langframe" : "rest", apiKey: "", apiKeySet: !options.unavailable, apiKeyUsable: !options.unavailable,
      config: { supplierKey: options.beta ? "custom-hierarchy-beta" : "custom-hierarchy-alpha",
        supplierName: options.beta ? "供应商乙" : "供应商甲", supplierId: options.account ?? (options.beta ? "account-b" : "account-a"),
        baseUrl: "http://127.0.0.1:9", usage: "canvas", modelGroup: group, ...(options.display ? { modelGroupLabel: options.display } : {}),
        defaultModel: models[0]?.id, modelCatalogModels: models, scannedModelIds: models.map(model => model.id), modelScanStatus: "live",
        connector: { models, restrictModels: true, submit: { path: "/never-submit", method: "POST", bodyMode: "json" }, output: { kind: "image", path: "$.data" } } } };
  };
  const connections = [
    connection("equal-name", "供应商甲 · AZURE-openai", "AZURE-openai"),
    connection("prefix-backup", "供应商甲 · 生图-openai-adobe-按次-备用", "生图-openai-adobe-按次"),
    connection("same-prefix-1", "同名连接", "同组"),
    connection("same-prefix-2", "同名连接", "同组"),
    connection("alias-a", "供应商甲 · 同名显示组", "langframe-key:stable-a", { display: "同名显示组" }),
    connection("alias-b", "供应商甲 · 同名显示组", "langframe-key:stable-b", { display: "同名显示组" }),
    connection("mojibake", "供应商甲 Â· AZURE-openai", "AZURE-openai"),
    connection("beta-long", `供应商乙 · ${longGroup}`, longGroup, { beta: true, models: [{ ...image, pricing: undefined, metadata: { canvasRunnable: true, priceLabel: longQuote } }] }),
    connection("beta-target", "目标连接", "另一账户组", { beta: true, account: "account-c", models: [{ ...image, id: "saved-target-model", name: "已保存目标模型" }] }),
    connection("beta-unavailable", "不可用连接", "停用组", { beta: true, unavailable: true,
      models: [{ ...image, pricing: undefined, metadata: { canvasRunnable: false, canvasUnavailableReason: "隔离目录仅展示" } }] }),
  ];
  if (longList) for (let index = 0; index < 28; index++) connections.push(connection(`long-${index}`, `长列表连接 ${index}`, `长列表分组 ${index}`, { beta: true }));
  const suppliers = ["account-a", "account-b", "account-c"].map((id, index) => ({
    id, name: index ? "供应商乙" : "供应商甲", supplierKey: index ? "custom-hierarchy-beta" : "custom-hierarchy-alpha",
    siteUrl: "http://127.0.0.1:9", apiUrl: "http://127.0.0.1:9", kind: "auto", catalog: { groups: [] }, scanStatus: "live",
    createdAt: timestamp, updatedAt: timestamp, state: { sourceId: id, billing: { sourceId: id, status: "live", balance: [26.637338, 22, 33][index],
      unit: "CNY", checkedAt: timestamp, sourceUrl: "http://127.0.0.1:9" } },
  }));
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === "/api/providers" && req.method() === "GET") return route.fulfill({ json: connections });
    if (path === "/api/suppliers" && req.method() === "GET") return route.fulfill({ json: suppliers });
    if (/^\/api\/suppliers\/[^/]+\/verification$/u.test(path) && req.method() === "GET") return route.fulfill({ json: null });
    const modelMatch = /^\/api\/providers\/([^/]+)\/models$/u.exec(path);
    if (modelMatch && req.method() === "GET" && !["refresh", "scan", "test"].some(key => url.searchParams.has(key))) {
      const candidate = connections.find(item => item.id === modelMatch[1]);
      return route.fulfill({ json: candidate?.config.modelCatalogModels ?? [], headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
    }
    if (path.startsWith("/api/providers") || path.startsWith("/api/suppliers") && path !== "/api/suppliers/catalog-upgrade"
      || path.startsWith("/api/runs") && req.method() !== "GET" || /\/(?:execute|materialize|preflight)$/u.test(path)) {
      prohibited.push(`${req.method()} ${path}`); return route.fulfill({ status: 409, json: { error: "隔离层级验收禁止供应商、Key 和生成操作" } });
    }
    if (path.startsWith("/api/canvas/") && req.method() === "PUT") writes.push(req.postDataJSON());
    return route.fallback();
  });
  const response = await request.post("/api/canvas", { data: { title: `线路层级隔离验收 ${crypto.randomUUID()}`, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "hierarchy", type: "workflow",
      position: { x: 70, y: 60 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation", label,
        provider: "rest", connectionId: currentId, model: image.id, parameters: {}, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const readNode = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
  const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const trigger = panel.getByRole("button", { name: `${label} 线路`, exact: true });
  const routes = panel.getByRole("dialog", { name: `${label} 候选线路`, exact: true });
  const row = (id: string) => routes.locator(`[data-route-id="${id}"]`);
  const choice = (id: string) => row(id).locator("[data-route-choice]");
  return { connections, panel, trigger, routes, row, choice, readNode, writes,
    assertSafe: () => expect({ prohibited, errors }).toEqual({ prohibited: [], errors: [] }) };
}

async function expectFocusedRowVisible(choice: Locator) {
  await expect(choice).toBeFocused();
  await expect.poll(() => choice.evaluate(element => {
    const list = element.closest('ul[aria-label="候选线路"]')!.getBoundingClientRect(), item = element.getBoundingClientRect();
    return item.top >= list.top - 1 && item.bottom <= list.bottom + 1;
  })).toBe(true);
}

for (const theme of ["light", "dark"] as const) for (const width of [360, 320]) {
  test(`线路层级截图 ${theme} ${width}px`, async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript(value => localStorage.setItem("supercanvas:appearance", value), theme);
    const f = await fixture(page, request);
    // Size the anchor, rather than shrinking the viewport: the actual surface
    // must be 320/360 px after its placement hook applies viewport margins.
    await f.trigger.evaluate((element, targetWidth) => { element.style.width = `${targetWidth}px`; }, width);
    await f.trigger.click(); await expect(f.routes).toBeVisible();
    await expect.poll(async () => Math.round((await f.routes.boundingBox())!.width)).toBe(width);
    const phase = before ? "before" : "after", directory = join(evidence, phase);
    await mkdir(directory, { recursive: true });
    await page.mouse.move(2, 2);
    await f.routes.screenshot({ path: join(directory, `route-hierarchy-${theme}-${width}.png`), animations: "disabled" });
    await writeFile(join(directory, `route-hierarchy-${theme}-${width}.json`), JSON.stringify({
      theme, requestedSurfaceWidth: width, surface: await f.routes.boundingBox(), phase, fixture: "hierarchy-v1",
    }, null, 2), "utf8");
    if (!before) {
      await expect(f.routes.getByRole("group", { name: "供应商甲 线路", exact: true })).toContainText("7 条线路");
      await expect(f.routes).not.toContainText("切换后将使用：—");
      const quote = f.row("beta-long").getByLabel("同型号报价", { exact: true });
      await expect(quote).toHaveText(longQuote);
      expect(await quote.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    f.assertSafe();
  });
}

test("供应商余额分层、身份去重、报价与可访问描述完整", async ({ page, request }) => {
  test.skip(before, "改动前仅采集相同 fixture 截图");
  await page.setViewportSize({ width: 1440, height: 1080 });
  const f = await fixture(page, request); await f.trigger.click();
  const alpha = f.routes.getByRole("group", { name: "供应商甲 线路", exact: true });
  const beta = f.routes.getByRole("group", { name: "供应商乙 线路", exact: true });
  await expect(alpha.getByRole("heading", { name: "供应商甲", exact: true })).toBeVisible();
  await expect(alpha.getByText("余额 26.637338 CNY", { exact: true })).toHaveCount(1);
  await expect(alpha).toHaveAccessibleDescription(/余额 26\.637338 CNY/u);
  await expect(alpha.locator("[data-route-choice]")).not.toContainText(["余额", "余额", "余额", "余额", "余额", "余额", "余额"]);
  await expect(beta.getByText("余额 22 CNY", { exact: true })).toHaveCount(2);
  await expect(beta.getByText("余额 33 CNY", { exact: true })).toHaveCount(1);
  await expect(f.choice("equal-name").locator("strong")).toHaveText("AZURE-openai");
  await expect(f.choice("prefix-backup").locator("strong")).toHaveText("生图-openai-adobe-按次-备用");
  for (const suffix of ["1", "2"]) await expect(f.choice(`same-prefix-${suffix}`)).toContainText(`same-prefix-${suffix}`);
  for (const suffix of ["a", "b"]) await expect(f.choice(`alias-${suffix}`)).toContainText(`langframe-key:stable-${suffix}`);
  await expect(f.choice("mojibake")).toContainText("Â· AZURE-openai");
  await expect(f.choice("beta-unavailable")).toHaveAttribute("aria-disabled", "true");
  await expect(f.choice("beta-unavailable")).toContainText("密钥未配置或不可用");
  await expect(f.choice("beta-unavailable")).not.toContainText("切换后将使用");
  await expect(f.choice("beta-target")).toContainText("切换后将使用：已保存目标模型");
  await expect(f.routes.getByLabel("报价比对型号", { exact: true })).toHaveText("同型号报价");
  await expect(f.routes.locator("details[open]")).toHaveCount(0);
  const summaries = f.routes.locator("summary");
  expect(await summaries.count()).toBeGreaterThan(0);
  await expect(summaries.first()).toHaveAccessibleName(/价格明细$/u);
  await summaries.first().click(); await expect(summaries.first().locator("..")).toHaveAttribute("open", "");
  for (const connection of f.connections) {
    await expect(f.choice(connection.id)).toHaveAccessibleDescription(new RegExp(`连接 ID：${connection.id}`, "u"));
    await expect(f.choice(connection.id)).toHaveAccessibleDescription(new RegExp(`分组 ID：${String(connection.config.modelGroup)}`, "u"));
  }
  const missingDescriptions = await f.routes.evaluate(element => [...element.querySelectorAll("[aria-describedby]")].flatMap(node =>
    (node.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(id => id && !document.getElementById(id))));
  expect(missingDescriptions).toEqual([]);
  f.assertSafe();
});

test("长列表初焦点可见、跨供应商键盘循环且仅保存连接 ID", async ({ page, request }) => {
  test.skip(before, "改动前仅采集相同 fixture 截图");
  await page.setViewportSize({ width: 1440, height: 720 });
  const f = await fixture(page, request, "long-27", true); await f.trigger.click();
  await expectFocusedRowVisible(f.choice("long-27"));
  await page.keyboard.press("Escape"); await expect(f.trigger).toBeFocused();
  await f.trigger.press("ArrowDown");
  const choices = f.routes.locator("[data-route-choice]");
  await expectFocusedRowVisible(choices.first());
  await page.keyboard.press("ArrowUp"); await expectFocusedRowVisible(choices.last());
  await page.keyboard.press("ArrowDown"); await expectFocusedRowVisible(choices.first());
  const lastAlpha = f.routes.getByRole("group", { name: "供应商甲 线路", exact: true }).locator("[data-route-choice]").last();
  await lastAlpha.focus(); await page.keyboard.press("ArrowDown");
  await expectFocusedRowVisible(f.routes.getByRole("group", { name: "供应商乙 线路", exact: true }).locator("[data-route-choice]").first());
  await page.keyboard.press("End"); await expectFocusedRowVisible(choices.last());
  await page.keyboard.press("Home"); await expectFocusedRowVisible(choices.first());
  const id = await choices.first().locator("..").getAttribute("data-route-id");
  const beforeData = await f.readNode();
  await page.keyboard.press("Enter"); await expect(f.routes).toBeHidden(); await expect(f.trigger).toBeFocused();
  await expect.poll(async () => (await f.readNode()).connectionId).toBe(id);
  const afterData = await f.readNode();
  expect(afterData.model).toBe(beforeData.model);
  expect(typeof afterData.connectionId).toBe("string");
  expect(afterData.connectionId).not.toContain("›");
  expect(f.writes.length).toBeGreaterThan(0);
  f.assertSafe();
});
