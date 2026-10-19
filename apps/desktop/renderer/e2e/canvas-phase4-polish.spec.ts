import { expectQuotedAmount, estimateAmount } from "./helpers/readable-facts";
import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { expectCompactPromptLine } from "./helpers/lod-expectations";
import { expect, test, type APIRequestContext, type Locator, type Page } from "./helpers/canvas-offline-test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvasStateVisualFixture } from "./helpers/canvas-state-visual-fixture";
import { canvasHandlePoint, waitForCanvasViewportStable } from "./canvas-test-actions";
import { expectParameterValue, openParameterDetails, readParameterOptions } from "./helpers/parameter-controls";

// Phase5 captures reuse the exact screen/asset fixtures; normal regression
// runs retain their default browser preference. No hidden theme mutation.
const evidenceTheme = process.env.UI_PHASE5_THEME;
if (evidenceTheme && evidenceTheme !== "light" && evidenceTheme !== "dark") throw new Error("Invalid UI_PHASE5_THEME");
test.beforeEach(async ({ page }) => {
  if (!evidenceTheme) return;
  await page.emulateMedia({ colorScheme: evidenceTheme as "light" | "dark" });
  await page.addInitScript(theme => localStorage.setItem("supercanvas:appearance", theme), evidenceTheme);
});

const output = process.env.UI_PHASE4_OUTPUT_DIR;
const phase = process.env.UI_PHASE4_PHASE ?? "after";
const viewport = process.env.UI_PHASE4_VIEWPORT ?? "1366x768";
if (!/^\d+x\d+$/u.test(viewport)) throw new Error("UI_PHASE4_VIEWPORT must use WIDTHxHEIGHT");
const [width, height] = viewport.split("x").map(Number);
if (!width || !height || width < 320 || height < 320) throw new Error("Invalid phase4 viewport");
test.use({ viewport: { width, height }, video: "off" });

type VisualFixture = Awaited<ReturnType<typeof createCanvasStateVisualFixture>>;
type NodeIdentity = { card: Element; body: Element | null; image: Element | null; status: Element | null };
type IdentityWindow = Window & { __phase4NodeIdentity?: Record<string, NodeIdentity> };
type ParameterScrollWindow = Window & { __phase4ParameterScrollWrites?: { nodeId: string; value: number }[] };

async function installFixture(page: Page, request: APIRequestContext, zoom = .8) {
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  let imageBuffer: Buffer | undefined;
  if (process.env.UI_PHASE4_VISUAL_ASSET_DIR) {
    const { loadPhase3VisualAssets } = await import("./helpers/phase3-visual-assets");
    const visual = await loadPhase3VisualAssets(process.env.UI_PHASE4_VISUAL_ASSET_DIR);
    imageBuffer = visual.previews[0]!.bytes;
    await test.info().attach("phase4-visual-thumbnail-source", {
      body: Buffer.from(JSON.stringify(visual.evidence, null, 2)), contentType: "application/json",
    });
  }
  const f = await createCanvasStateVisualFixture(request, imageBuffer);
  // Phase4 alone adds existing video/music types. The original twelve nodes
  // and the phase2/default performance fixture are untouched.
  for (const [id, nodeType, label, kind, y] of [
    ["phase4-video", "video-generation", "视频创作 · 分镜", "video", 360],
    ["phase4-music", "music-generation", "音乐创作 · 声场", "audio", 660],
  ] as const) f.graph.nodes.push({ id, type: "workflow", position: { x: 1460, y }, style: { width: 300, height: 220 }, data: {
    nodeType, label, provider: "fake", parts: [{ type: "text", text: "只展示已有类型与视觉层级，不提交生成。" }], parameters: {},
    inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: kind, kind, label: kind === "video" ? "视频" : "音频" }],
  } });
  const graph = { ...f.graph, viewport: { x: 120, y: 80, zoom } };
  const saved = await request.put(`/api/canvas/${f.canvas.id}`, { data: { graph } });
  expect(saved.ok()).toBeTruthy();
  const errors: string[] = [], warnings: string[] = [];
  let submissions = 0, outbound = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) warnings.push(`${message.type()}: ${message.text()}`); });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) { outbound++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/runs(?:\?|\/|$)/u, route => {
    if (route.request().method() !== "GET") { submissions++; return route.abort(); }
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
    return route.fulfill({ json: path === "/api/runs" ? [f.snapshot] : f.snapshot });
  });
  await page.route("**/api/agent/turn", route => { submissions++; return route.abort(); });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade*", route => route.fulfill({ json: idleCatalogCheckFixture() }));
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [f.connection, f.fake] }) : route.continue());
  await page.route(`**/api/providers/${f.connection.id}/models*`, route => route.fulfill({ json: f.models,
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  await page.route(`**/api/providers/${f.fake.id}/models*`, route => route.fulfill({ json: [{ id: "fake-image-v1", name: "Fake",
    operations: ["image.generate"], inputKinds: ["text", "image"], outputKinds: ["image"] }], headers: { "X-Model-Scan-Status": "live" } }));
  await page.route("**/api/agent/models**", route => route.fulfill({ json: [] }));
  await page.route("**/api/agent/sessions", route => route.fulfill({ json: [] }));
  const check = () => { expect(errors).toEqual([]); expect(warnings).toEqual([]); expect(submissions).toBe(0); expect(outbound).toBe(0); };
  return { ...f, errors, warnings, check, counters: () => ({ submissions, outbound }) };
}

function node(page: Page, id: string) { return page.locator(`.react-flow__node[data-id="${id}"]`); }
async function openCanvas(page: Page, f: VisualFixture) {
  await page.goto(`/canvas/${f.canvas.id}`);
  await expect(node(page, "prompt")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(14);
  for (const status of ["queued", "running", "succeeded", "failed"]) {
    await expect(node(page, `source-${status}`).locator(".node-card")).toHaveAttribute("data-node-status", status);
  }
}
async function exposedPanePoint(page: Page) {
  const point = await page.evaluate(() => {
    const points: { x: number; y: number; distance: number }[] = [];
    for (let y = 88; y < innerHeight - 88; y += 38) for (let x = 96; x < innerWidth - 32; x += 38)
      points.push({ x, y, distance: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) });
    return points.sort((a, b) => a.distance - b.distance).find(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) ?? null;
  });
  expect(point, "必须在真正画布空白处滚轮/取消选择，不能命中悬浮岛或节点").not.toBeNull();
  return point!;
}
async function zoomValue(page: Page) {
  return page.locator(".react-flow__viewport").evaluate(element => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth);
}
async function zoomTo(page: Page, target: number) {
  await waitForCanvasViewportStable(page);
  const point = await exposedPanePoint(page);
  await page.mouse.move(point.x, point.y);
  // Real D3 wheel input; never mutate its store, React state or inline transform.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await zoomValue(page);
    if (Math.abs(current - target) < .001) break;
    await page.mouse.wheel(0, Math.log(current / target) / (Math.LN2 * .002));
    await page.waitForTimeout(220);
  }
  await expect.poll(() => zoomValue(page)).toBeCloseTo(target, 2);
  await waitForCanvasViewportStable(page);
}
async function visibleLabel(label: Locator) {
  return label.evaluate(element => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) < .01) return false;
    }
    return true;
  });
}
async function expectCapsule(label: Locator) {
  await expect.poll(async () => await visibleLabel(label) || await label.getAttribute("data-label-obscured") === "true").toBe(true);
  if (await label.getAttribute("data-label-obscured") === "true") {
    await expect(label).toHaveCSS("visibility", "hidden");
    const title = await label.getAttribute("title");
    expect(title).toBeTruthy();
    await expect(label.locator("..").locator(`.react-flow__handle[title=${JSON.stringify(title)}]`)).toHaveCount(1);
    return;
  }
  const style = await label.evaluate(element => {
    const s = getComputedStyle(element);
    return { font: Number.parseFloat(s.fontSize), radius: Number.parseFloat(s.borderRadius), background: s.backgroundColor };
  });
  expect(style.font).toBeGreaterThanOrEqual(11);
  expect(style.radius).toBeGreaterThanOrEqual(6);
  expect(style.background).not.toMatch(/^(?:transparent|rgba\(0,\s*0,\s*0,\s*0\))$/u);
}
async function rememberNodeIdentity(page: Page) {
  await page.evaluate(() => {
    (window as IdentityWindow).__phase4NodeIdentity = Object.fromEntries([...document.querySelectorAll(".react-flow__node")].map(wrapper => [wrapper.getAttribute("data-id")!, {
      card: wrapper.querySelector(".node-card")!, body: wrapper.querySelector(".node-body"), image: wrapper.querySelector("img"), status: wrapper.querySelector(".node-status-label"),
    }]));
  });
}
async function expectSameNodeIdentity(page: Page) {
  const identities = await page.evaluate(() => Object.entries((window as IdentityWindow).__phase4NodeIdentity ?? {}).map(([id, saved]) => {
    const wrapper = [...document.querySelectorAll(".react-flow__node")].find(element => element.getAttribute("data-id") === id);
    return { id, card: saved.card.isConnected && wrapper?.querySelector(".node-card") === saved.card,
      body: wrapper?.querySelector(".node-body") === saved.body, image: wrapper?.querySelector("img") === saved.image,
      status: wrapper?.querySelector(".node-status-label") === saved.status };
  }));
  expect(identities).toHaveLength(14);
  for (const identity of identities) expect(identity, identity.id).toMatchObject({ card: true, body: true, image: true, status: true });
}
async function openParameters(page: Page) {
  await node(page, "parameters").locator(".node-head").click();
  await page.getByRole("button", { name: /定位所选/ }).click();
  await page.getByRole("button", { name: "打开 完整图片参数 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "完整图片参数 模型与参数", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}
async function assertImageControls(panel: Locator) {
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  await tiers.scrollIntoViewIfNeeded();
  await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
  expect(await tiers.getByRole("button").evaluateAll(elements => Math.max(...elements.map(x => x.getBoundingClientRect().top)) - Math.min(...elements.map(x => x.getBoundingClientRect().top)))).toBeLessThan(1);
  const size = panel.getByLabel("输出分辨率预设", { exact: true });
  const fourK = (await readParameterOptions(size)).filter(option => option.value === "3840x2160");
  expect(fourK).toHaveLength(1);
  for (const detail of ["4K", "16:9", "3840 × 2160"]) expect(fourK[0]!.label).toContain(detail);
  await openParameterDetails(panel, "自定义宽高");
  for (const [label, value] of [["图片宽度", "3840"], ["图片高度", "2160"], ["质量", "max"]] as const) {
    const control = panel.getByLabel(label, { exact: true });
    await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible(); await expectParameterValue(control, value);
  }
  const mode = panel.getByLabel("生成模式", { exact: true });
  await expect(mode).toBeAttached(); await mode.scrollIntoViewIfNeeded({ timeout: 10_000 }); await expect(mode).toBeVisible();
  // Price labels and values share a single div; exact text matching the label
  // alone cannot match that element. Use the real public price-group label.
  const price = panel.getByLabel("当前参数价格", { exact: true });
  await openParameterDetails(panel, "价格明细");
  await expect(price).toBeAttached(); await price.scrollIntoViewIfNeeded({ timeout: 10_000 }); await expect(price).toBeVisible();
  await expect(price).toContainText("型号报价"); await expect(price).toContainText("本次预计费用");
  // The evidence disclosure has its own heading; assert the two price rows.
  await expectQuotedAmount(price.getByRole("region", { name: "型号报价", exact: true }), 0.1, "USD", "次");
  await expect(estimateAmount(price)).toHaveText("0.1 USD");
}

test("根参数卡首次打开不强制写滚动位置，切换真实型号仍重置已滚动内容", async ({ page, request }) => {
  const f = await installFixture(page, request);
  // Fake deliberately exposes its one built-in model. Use the existing
  // UI-only connection for a two-model catalog; every request stays mocked,
  // while generation remains prohibited by the original fixture guards.
  // Extra fields make the real parameter body scroll without CSS mutation.
  const models = [0, 1].map(index => ({ ...f.models[0]!, id: `phase4-scroll-image-${index}`,
    name: `隔离滚动型号 ${index + 1}`, parameters: [...f.models[0]!.parameters!,
      ...Array.from({ length: 8 }, (_, field) => ({ key: `scroll_fixture_${field}`, label: `隔离滚动参数 ${field + 1}`,
        control: "select" as const, valueType: "string" as const, default: "first",
        options: [{ label: "第一档", value: "first" }, { label: "第二档", value: "second" }] })),
    ] }));
  const connection = { ...f.connection, config: { ...f.connection.config, defaultModel: models[0]!.id,
    modelCatalogModels: models, scannedModelIds: models.map(model => model.id) } };
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [connection, f.fake] }) : route.fallback());
  const modelRequests: string[] = [];
  await page.route(`**/api/providers/${connection.id}/models*`, route => {
    modelRequests.push(route.request().url());
    return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  const graph = { ...f.graph, viewport: { x: 120, y: 80, zoom: .8 }, nodes: f.graph.nodes.map(item => item.id !== "parameters" ? item : {
    ...item, data: { ...item.data, provider: connection.provider, connectionId: connection.id, model: models[0]!.id },
  }) };
  const updated = await request.put(`/api/canvas/${f.canvas.id}`, { data: { graph } });
  expect(updated.ok()).toBeTruthy();
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    if (!descriptor?.get || !descriptor.set) throw new Error("Missing native scrollTop accessor");
    const nativeSet = descriptor.set;
    const writes: { nodeId: string; value: number }[] = [];
    (window as ParameterScrollWindow).__phase4ParameterScrollWrites = writes;
    Object.defineProperty(Element.prototype, "scrollTop", { ...descriptor, set(value: number) {
      // Observe only the actual root card's scrolling element, never nodes,
      // list virtualization or other panels, and retain the native behavior.
      const owner = this instanceof Element && this.matches(".node-config-popover-body")
        ? this.closest(".canvas-parameter-dock[data-parameter-node-id]") : null;
      if (owner) writes.push({ nodeId: owner.getAttribute("data-parameter-node-id")!, value });
      nativeSet.call(this, value);
    } });
  });
  await openCanvas(page, f);
  const panel = await openParameters(page);
  const body = panel.locator(".node-config-popover-body");
  const picker = panel.getByRole("combobox", { name: "完整图片参数 模型", exact: false });
  await expect(picker).toContainText(models[0]!.name);
  await expect.poll(() => modelRequests.length).toBeGreaterThan(0);
  expect(new URL(modelRequests[0]!).pathname).toBe(`/api/providers/${connection.id}/models`);
  await expect(panel.getByLabel("隔离滚动参数 8", { exact: true })).toBeAttached();
  await expect(panel.locator('[data-panel-loading="true"]')).toHaveCount(0);
  const writes = () => page.evaluate(() => (window as ParameterScrollWindow).__phase4ParameterScrollWrites?.filter(write => write.nodeId === "parameters") ?? []);
  expect(await body.evaluate(element => element.scrollTop)).toBe(0);
  expect(await writes()).toEqual([]);
  await body.evaluate(element => { (element as HTMLElement).dataset.phase4ScrollIdentity = "retained"; });
  await picker.click();
  const next = panel.getByRole("option", { name: models[1]!.name, exact: true });
  await expect(next).toBeVisible();
  // The menu is already open so locating its trigger cannot scroll the body
  // back to the top before the model change under test.
  await body.evaluate(element => { element.scrollTop = 180; });
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await writes()).filter(write => write.value === 0)).toEqual([]);
  await next.click();
  await expect(picker).toContainText(models[1]!.name);
  await expect.poll(async () => (await writes()).filter(write => write.value === 0).length).toBe(1);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0);
  await expect(body).toHaveAttribute("data-phase4-scroll-identity", "retained");
  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/${f.canvas.id}`);
    const saved = await response.json();
    return saved.graph.nodes.find((item: { id: string; data: { model?: string } }) => item.id === "parameters")?.data.model;
  }).toBe(models[1]!.id);
  f.check();
});

test("主题类型图标尺寸与无装饰顶条，端口标签只在悬停、选中或拖线时显示胶囊", async ({ page, request }, testInfo) => {
  const f = await installFixture(page, request);
  await openCanvas(page, f);
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await zoomTo(page, .8);
  const card = node(page, "caption").locator(".node-card");
  await expect(card.locator(".node-icon")).toHaveCSS("width", "22px");
  await expect(card.locator(".node-icon")).toHaveCSS("height", "22px");
  await expect.poll(() => card.evaluate(element => {
    const style = getComputedStyle(element, "::before");
    return style.content === "none" || style.display === "none";
  })).toBe(true);
  const label = card.locator(".port-label").first();
  const point = await exposedPanePoint(page); await page.mouse.move(point.x, point.y);
  await expect.poll(() => visibleLabel(label)).toBe(false);
  await card.locator(".node-head").hover(); await expectCapsule(label);
  await card.locator(".node-head").click(); await page.mouse.move(point.x, point.y); await expectCapsule(label);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => visibleLabel(label)).toBe(false);
  const source = node(page, "asset").locator('.react-flow__handle.source[data-port-kind="image"]');
  await waitForCanvasViewportStable(page);
  const sourcePoint = await canvasHandlePoint(source);
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down(); await page.mouse.move(sourcePoint.x - 24, sourcePoint.y + 40, { steps: 4 });
  await expect(node(page, "parameters").locator(".node-card")).toHaveAttribute("data-connection-highlight", "compatible");
  await expectCapsule(node(page, "parameters").locator('.port-label[title^="参考图"]'));
  const geometry = await page.locator(".port-label").evaluateAll(elements => {
    const labels = elements.filter(element => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        const s = getComputedStyle(current);
        if (s.visibility !== "visible" || s.display === "none" || Number(s.opacity) < .01) return false;
      }
      return true;
    }).map(element => {
      const box = element.getBoundingClientRect(), card = element.closest(".node-card")!.getBoundingClientRect();
      return { node: element.closest(".react-flow__node")!.getAttribute("data-id"), text: element.textContent,
        x: box.left, y: box.top, right: box.right, bottom: box.bottom,
        outside: element.classList.contains("left") ? box.right < card.left : box.left > card.right,
        opaque: getComputedStyle(element).backgroundColor.startsWith("rgb(") };
    });
    const overlaps = [];
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!, b = labels[j]!;
      const width = Math.min(a.right, b.right) - Math.max(a.x, b.x), height = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (width > .01 && height > .01) overlaps.push({ a, b, width, height, area: width * height });
    }
    const cardOverlaps = labels.flatMap(label => [...document.querySelectorAll(".node-card")].flatMap(card => {
      const box = card.getBoundingClientRect();
      const width = Math.min(label.right, box.right) - Math.max(label.x, box.left);
      const height = Math.min(label.bottom, box.bottom) - Math.max(label.y, box.top);
      return width > .01 && height > .01 ? [{ label, card: card.closest(".react-flow__node")?.getAttribute("data-id"), width, height }] : [];
    }));
    return { labels, overlaps, cardOverlaps };
  });
  await testInfo.attach("phase4-port-capsule-geometry", { body: Buffer.from(JSON.stringify(geometry, null, 2)), contentType: "application/json" });
  expect(geometry.labels.length).toBeGreaterThan(0);
  expect(geometry.labels.filter(label => !label.outside), "标签应在把手外侧，不能覆盖所属卡片正文").toEqual([]);
  expect(geometry.labels.filter(label => !label.opaque), "端口标签使用实心背景保持可读").toEqual([]);
  expect(geometry.cardOverlaps, "任何可见端口标签都不能覆盖邻卡正文").toEqual([]);
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.press("Escape");
  f.check();
});

test("第四阶段LOD在0.55两侧切换，保留媒体和首行且不重挂节点、图片或独立参数卡", async ({ page, request }) => {
  const f = await installFixture(page, request, .56);
  await openCanvas(page, f);
  const viewport = page.locator(".react-flow__viewport");
  const body = node(page, "prompt").locator(".node-body");
  await expect(viewport).not.toHaveClass(/canvas-lod-compact/u);
  await expect(body).toHaveCSS("visibility", "visible");
  for (const id of ["asset", "result-succeeded"]) await expect(node(page, id).locator("img")).toBeVisible();
  await rememberNodeIdentity(page);
  const outerSizes = () => page.locator(".react-flow__node").evaluateAll(nodes => nodes.map(element => ({
    id: element.getAttribute("data-id"), width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight,
  })));
  const nearSizes = await outerSizes();
  await zoomTo(page, .4);
  await expect(viewport).toHaveClass(/canvas-lod-compact/u);
  await expect.poll(() => page.locator(".port-label").evaluateAll(labels => labels.every(label => getComputedStyle(label).visibility === "hidden"))).toBe(true);
  for (const id of ["prompt", "source-running", "result-succeeded", "result-failed"]) {
    await expect(node(page, id).locator(".node-body")).toHaveCSS("visibility", "visible");
    await expect(node(page, id).locator(".node-head")).toBeVisible();
  }
  await expect(node(page, "result-running").locator(".node-status-label")).toHaveCount(1);
  await expect(node(page, "result-running").locator(".node-status-label")).toBeVisible();
  await expect(node(page, "result-succeeded").locator(".node-result-title")).toBeVisible();
  for (const id of ["asset", "result-succeeded"]) await expect(node(page, id).locator("img")).toBeVisible();
  await expect(node(page, "prompt").locator(".prompt-overview")).toBeVisible();
  await expectCompactPromptLine(node(page, "prompt").locator(".prompt-overview"));
  expect(await outerSizes(), "LOD must preserve the measured outer dimensions of every node").toEqual(nearSizes);
  await expectSameNodeIdentity(page);
  await node(page, "parameters").locator(".node-head").dblclick();
  const distantPanel = page.getByRole("dialog", { name: "完整图片参数 模型与参数", exact: true });
  await expect(distantPanel).toBeVisible();
  await expect.poll(() => zoomValue(page)).toBeCloseTo(.4, 2);
  await assertImageControls(distantPanel);
  await distantPanel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
  await zoomTo(page, .56);
  await expect(viewport).not.toHaveClass(/canvas-lod-compact/u);
  await expect(body).toHaveCSS("visibility", "visible");
  expect(await outerSizes(), "Returning from LOD must preserve every node size").toEqual(nearSizes);
  await expectSameNodeIdentity(page);
  const panel = await openParameters(page);
  await assertImageControls(panel);
  await panel.evaluate(element => { (element as HTMLElement).dataset.phase4Identity = "retained"; });
  await rememberNodeIdentity(page);
  await zoomTo(page, .54);
  await expect(viewport).toHaveClass(/canvas-lod-compact/u);
  await expect(panel).toHaveAttribute("data-phase4-identity", "retained");
  await assertImageControls(panel);
  await expectSameNodeIdentity(page);
  await zoomTo(page, .56);
  await expect(viewport).not.toHaveClass(/canvas-lod-compact/u);
  await expect(panel).toHaveAttribute("data-phase4-identity", "retained");
  await assertImageControls(panel);
  f.check();
});

test("第四阶段Agent开关保留键盘焦点、草稿与可用画布避让", async ({ page, request }) => {
  const f = await installFixture(page, request);
  await openCanvas(page, f);
  const toggle = page.getByRole("button", { name: "智能体面板", exact: true });
  const aside = page.locator("aside.inspector");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus(); await expect(toggle).toBeFocused(); await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(aside).toBeVisible(); await expect(aside).toHaveClass(/\bmobile-open\b/u);
  await expect(toggle).toBeFocused();
  const input = page.getByRole("textbox", { name: "创作任务要求", exact: true });
  await expect(input).toBeVisible(); await input.fill("收起后仍保留的第四阶段输入草稿");
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const clear = async () => {
    const panel = await aside.boundingBox(); expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0); expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(width); expect(panel!.y + panel!.height).toBeLessThanOrEqual(height);
    await expect.poll(() => page.locator(".react-flow__node").evaluateAll((elements, right) =>
      elements.every(element => element.getBoundingClientRect().right <= right - 8), panel!.x)).toBe(true);
  };
  await clear();
  await node(page, "parameters").locator(".node-head").click();
  await page.getByRole("button", { name: /定位所选/ }).click();
  await expect.poll(async () => {
    const [card, panel] = await Promise.all([node(page, "parameters").boundingBox(), aside.boundingBox()]);
    return Boolean(card && panel && card.x >= 80 && card.x + card.width <= panel.x - 8);
  }).toBe(true);
  await toggle.focus(); await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false"); await expect(aside).toBeHidden(); await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true"); await expect(aside).toBeVisible();
  await expect(input).toHaveValue("收起后仍保留的第四阶段输入草稿");
  await toggle.focus(); await page.keyboard.press("Enter"); await expect(aside).toBeHidden(); await expect(toggle).toBeFocused();
  const minimapToggle = page.getByRole("button", { name: "小地图", exact: true });
  if (await minimapToggle.getAttribute("aria-pressed") !== "true") await minimapToggle.click();
  const minimap = page.locator(".react-flow__minimap"), toolbar = page.locator(".canvas-toolbar");
  await expect(minimap).toBeVisible();
  await waitForCanvasViewportStable(page);
  const measureCanvas = () => node(page, "parameters").evaluate(wrapper => {
    const rect = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport")!;
    return { node: rect(wrapper.querySelector(".node-card")!), handle: rect(wrapper.querySelector(".react-flow__handle")!),
      viewport: rect(viewport), viewportWidth: viewport.offsetWidth, viewportHeight: viewport.offsetHeight,
      transform: getComputedStyle(viewport).transform };
  });
  const geometryBeforeParameters = await measureCanvas();
  await node(page, "parameters").getByRole("button", { name: "打开 完整图片参数 模型与参数", exact: true }).click();
  const parameters = page.getByRole("dialog", { name: "完整图片参数 模型与参数", exact: true });
  await expect(parameters).toBeVisible();
  await expect(parameters.locator('[data-panel-loading="true"]')).toHaveCount(0);
  expect(await page.locator(".canvas-editor").evaluate(element => (element as HTMLElement).style.getPropertyValue("--canvas-occluded-right"))).toBe("");
  for (const consumer of [toolbar, minimap]) {
    await expect.poll(() => consumer.evaluate(element => getComputedStyle(element).getPropertyValue("--canvas-occluded-right").trim())).toBe("392px");
    await expect.poll(async () => {
      const [tools, panel] = await Promise.all([consumer.boundingBox(), parameters.boundingBox()]);
      return Boolean(tools && panel && tools.x + tools.width <= panel.x - 8);
    }, { message: "仅工具消费者避让单参数卡，不能遮挡其内容" }).toBe(true);
  }
  expect(await measureCanvas()).toEqual(geometryBeforeParameters);
  await parameters.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
  f.check();
});

test("第四阶段减少动态效果下首次懒加载骨架静止且Esc可关闭", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installFixture(page, request);
  await openCanvas(page, f);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const holdChunk = async (route: import("@playwright/test").Route) => { await held; await route.continue(); };
  await page.route("**/_next/static/chunks/*.js", holdChunk);
  try {
    await page.getByRole("button", { name: "API 设置", exact: true }).click();
    const skeleton = page.locator('[data-panel-loading="true"][aria-busy="true"]').first();
    await expect(skeleton).toBeVisible();
    const snapshot = () => skeleton.evaluate(element => ({
      running: element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length,
      children: [element, ...element.querySelectorAll("*")].map(child => {
        const s = getComputedStyle(child);
        return { animation: s.animationName, transform: s.transform, opacity: s.opacity, backgroundPosition: s.backgroundPosition };
      }),
    }));
    const start = await snapshot();
    expect(start.running).toBe(0);
    expect(start.children.every(s => s.animation === "none")).toBe(true);
    await page.waitForTimeout(160); expect(await snapshot()).toEqual(start);
    await page.keyboard.press("Escape"); await expect(skeleton).toBeHidden();
  } finally { release(); await page.unroute("**/_next/static/chunks/*.js", holdChunk); }
  f.check();
});

test("第四阶段两尺寸节点层级与远景视觉证据", async ({ page, request }, testInfo) => {
  test.skip(!output, "Set UI_PHASE4_OUTPUT_DIR to capture phase4 screenshots");
  test.setTimeout(120_000);
  await mkdir(output!, { recursive: true });
  const f = await installFixture(page, request);
  const screenshots: string[] = [];
  const shot = async (name: string) => {
    await page.mouse.move(4, 4);
    if (await page.locator(".react-flow__viewport").count()) await waitForCanvasViewportStable(page);
    await page.waitForTimeout(180);
    const file = `${phase}-${name}.png`;
    await page.screenshot({ path: join(output!, file) }); screenshots.push(file);
  };
  await page.goto("/"); await expect(page.locator("h1")).toBeVisible(); await shot("home");
  await openCanvas(page, f);
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  for (const status of ["queued", "running", "succeeded", "failed"]) await expect(page.locator(`[data-generated-status="${status}"]`)).toHaveCount(1);
  await shot("canvas-states");
  const panel = await openParameters(page);
  await assertImageControls(panel);
  await panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true }).scrollIntoViewIfNeeded(); await shot("parameters-tiers");
  await panel.getByLabel("图片宽度", { exact: true }).scrollIntoViewIfNeeded(); await shot("parameters-dimensions");
  await panel.getByLabel("质量", { exact: true }).scrollIntoViewIfNeeded(); await shot("parameters-quality");
  await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
  const agent = page.getByRole("button", { name: "智能体面板", exact: true });
  await agent.click(); await expect(page.getByRole("textbox", { name: "创作任务要求", exact: true })).toBeVisible(); await shot("agent");
  await agent.click(); await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await waitForCanvasViewportStable(page);
  await zoomTo(page, .42); await shot("canvas-far");
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await waitForCanvasViewportStable(page);
  const source = node(page, "asset").locator('.react-flow__handle.source[data-port-kind="image"]');
  const sourcePoint = await canvasHandlePoint(source);
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down(); await page.mouse.move(sourcePoint.x - 120, sourcePoint.y + 100, { steps: 6 });
  await expect(node(page, "parameters").locator(".node-card")).toHaveAttribute("data-connection-highlight", "compatible");
  // Keep the held pointer/connection feedback in the image.
  const file = `${phase}-connecting-ports.png`; await page.screenshot({ path: join(output!, file) }); screenshots.push(file);
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.press("Escape");
  f.check();
  const report = { phase, viewport: { width, height }, buildId: process.env.UI_PHASE4_EXPECTED_BUILD_ID ?? null,
    captureMode: "functional-visual-only", screenshots, fixture: { nodes: 14, states: ["queued", "running", "succeeded", "failed"], source: "existing 12-node phase2 fixture plus 2 existing video/music types", ...f.counters() },
    errors: f.errors, warnings: f.warnings };
  const path = join(output!, `${phase}-screenshots.json`); await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("phase4-visual-evidence", { path, contentType: "application/json" });
});
