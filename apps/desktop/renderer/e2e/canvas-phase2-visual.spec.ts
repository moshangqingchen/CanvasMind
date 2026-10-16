import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvasStateVisualFixture as createFixture } from "./helpers/canvas-state-visual-fixture";

const output = process.env.UI_PHASE2_OUTPUT_DIR;
const phase = process.env.UI_PHASE2_PHASE ?? "sample";
const requestedViewport = process.env.UI_PHASE2_VIEWPORT;
if (requestedViewport && !/^\d+x\d+$/u.test(requestedViewport)) throw new Error("UI_PHASE2_VIEWPORT must use WIDTHxHEIGHT, e.g. 1366x768");
const [requestedWidth, requestedHeight] = requestedViewport?.split("x").map(Number) ?? [1600, 1100];
const viewport = { width: requestedWidth!, height: requestedHeight! };
if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) || viewport.width < 320 || viewport.height < 320)
  throw new Error("UI_PHASE2_VIEWPORT must contain integer dimensions of at least 320x320");
type AuraWindow = typeof window & { __auraDraws: number[]; __auraFrame: { drawn: boolean } | null };

async function instrumentAura(page: Page) {
  await page.addInitScript(() => {
    const w = window as AuraWindow;
    w.__auraDraws = [];
    w.__auraFrame = null;
    const originalClear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (w.__auraFrame && this.canvas.closest("[data-animating]")) w.__auraFrame.drawn = true;
      return originalClear.apply(this, args);
    };
    const originalRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => originalRaf(now => {
      const capture = { drawn: false };
      w.__auraFrame = capture;
      const start = performance.now();
      try { callback(now); }
      finally {
        if (capture.drawn) w.__auraDraws.push(performance.now() - start);
        w.__auraFrame = null;
      }
    });
  });
}

async function assertUnobstructed(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const available = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return Boolean(rect.width && rect.height && (hit === element || element.contains(hit)));
  });
  expect(available, "关键控件应在滚动后可见且不被覆盖").toBe(true);
}

test.use({ viewport, trace: output ? "retain-on-failure" : "on", video: "off" });
test("第二阶段隔离视觉证据与完整控件", async ({ page, request }, testInfo) => {
  test.skip(!output, "Set UI_PHASE2_OUTPUT_DIR to capture phase2 evidence");
  test.setTimeout(240_000);
  await mkdir(output!, { recursive: true });
  await instrumentAura(page);
  const fixture = await createFixture(request);
  const errors: string[] = [], warnings: string[] = [];
  let submissions = 0, externalRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) warnings.push(`${message.type()}: ${message.text()}`); });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) { externalRequests++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/runs(?:\?|\/|$)/u, route => {
    if (route.request().method() !== "GET") { submissions++; return route.abort(); }
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "data: fixture\n\n" });
    return route.fulfill({ json: path === "/api/runs" ? [fixture.snapshot] : fixture.snapshot });
  });
  await page.route("**/api/agent/turn", route => { submissions++; return route.abort(); });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade", route => route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } }));
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [fixture.connection, fixture.fake] }) : route.continue());
  await page.route(`**/api/providers/${fixture.connection.id}/models*`, route => route.fulfill({ json: fixture.models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  await page.route(`**/api/providers/${fixture.fake.id}/models*`, route => route.fulfill({ json: [{ id: "fake-image-v1", name: "Fake", operations: ["image.generate"], inputKinds: ["text", "image"], outputKinds: ["image"] }], headers: { "X-Model-Scan-Status": "live" } }));
  const screenshots: string[] = [];
  const surfaceStyles: Record<string, unknown> = {};
  const shot = async (name: string) => {
    // Visibility alone permits an intermediate frame of the 180ms entrance.
    // Finite animations finish; queue/running/aura loops retain their state.
    await page.waitForTimeout(220);
    await page.evaluate(async () => {
      const opening = document.getAnimations().filter(animation => animation.playState === "running"
        && Number.isFinite(animation.effect?.getTiming().iterations ?? Infinity));
      await Promise.all(opening.map(animation => animation.finished.catch(() => undefined)));
    });
    const target = name === "home" ? page.locator("h1").first()
      : name === "agent" ? page.locator(".agent-panel")
        : name === "model-picker" ? page.getByRole("listbox").first()
          : name === "failure-diagnosis" ? page.getByRole("dialog", { name: "结果来源与参数", exact: true })
          : name.startsWith("image-parameters") ? page.getByRole("dialog", { name: "完整图片参数 模型与参数", exact: true }) : null;
    if (target) {
      await expect.poll(() => target.evaluate(element => {
        let opacity = 1;
        for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      })).toBeGreaterThanOrEqual(.99);
      surfaceStyles[name] = await target.evaluate(element => {
        const chain = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          chain.push({ tag: node.tagName, className: node.getAttribute("class"), opacity: style.opacity, color: style.color,
            backgroundColor: style.backgroundColor, backdropFilter: style.backdropFilter, animationName: style.animationName });
        }
        return chain;
      });
    }
    const file = `${phase}-${name}.png`;
    await page.screenshot({ path: join(output!, file) }); screenshots.push(file);
  };
  await page.goto("/");
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as AuraWindow).__auraDraws.length)).toBeGreaterThan(20);
  await shot("home");
  const aura = await page.evaluate(() => {
    const frames = [...(window as AuraWindow).__auraDraws].sort((a, b) => a - b);
    return { samples: frames.length, medianMs: frames[Math.floor(frames.length * .5)], p95Ms: frames[Math.floor(frames.length * .95)], maxMs: frames.at(-1), cpuRate: 1 };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-animating]").first()).toHaveAttribute("data-animating", "false");
  await page.waitForTimeout(150);
  const pausedCount = await page.evaluate(() => (window as AuraWindow).__auraDraws.length);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as AuraWindow).__auraDraws.length)).toBe(pausedCount);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(150);
  const hiddenCount = await page.evaluate(() => (window as AuraWindow).__auraDraws.length);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as AuraWindow).__auraDraws.length)).toBe(hiddenCount);
  await page.evaluate(() => { Reflect.deleteProperty(document, "hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  await page.goto(`/canvas/${fixture.canvas.id}`);
  await expect(page.locator('.react-flow__node[data-id="parameters"]')).toBeVisible();
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  if ((await inspector.getAttribute("aria-expanded")) === "true") await inspector.click();
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await page.waitForTimeout(700);
  for (const state of ["queued", "running", "succeeded", "failed"]) await expect(page.locator(`[data-generated-status="${state}"]`)).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(12);
  await shot("canvas-states");
  const failedResult = page.locator('.react-flow__node[data-id="result-failed"]');
  await failedResult.locator("summary").filter({ hasText: "来源与任务" }).click();
  const diagnose = failedResult.getByRole("button", { name: "查看 失败 · 图片结果 来源", exact: true });
  await assertUnobstructed(diagnose);
  await diagnose.click();
  const failure = page.getByRole("dialog", { name: "结果来源与参数", exact: true });
  await failure.locator("summary").filter({ hasText: "查看完整错误详情" }).click();
  const diagnosis = failure.getByRole("group", { name: "失败诊断", exact: true });
  await expect(diagnosis).toBeVisible();
  await expect(diagnosis).toContainText("隔离示例：模拟生成失败，可查看原因");
  for (const label of ["失败原因", "扣费状态", "金额", "下一步"]) await expect(diagnosis.getByText(label, { exact: true })).toBeVisible();
  await expect(failure.getByRole("button", { name: "关闭来源详情", exact: true })).toBeVisible();
  await shot("failure-diagnosis");
  await page.keyboard.press("Escape");
  await expect(failure).toHaveCount(0);
  await expect(diagnose).toBeFocused();
  surfaceStyles["failure-diagnosis-dismissal"] = { escapeClosed: true, focusReturnedToAction: true };
  await page.locator('.react-flow__node[data-id="parameters"] .node-head').click();
  await page.getByRole("button", { name: /定位所选/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "打开 完整图片参数 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "完整图片参数 模型与参数", exact: true });
  // The fixed root deck and the older portal expose the same public dialog;
  // do not scope parameters under a React Flow node that may now be culled.
  if (phase === "after") await expect(panel).toHaveAttribute("data-config-node-id", "parameters");
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  const size = panel.getByLabel("输出分辨率预设", { exact: true });
  const width = panel.getByLabel("图片宽度", { exact: true });
  const height = panel.getByLabel("图片高度", { exact: true });
  const quality = panel.getByLabel("质量", { exact: true });
  await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
  expect(await tiers.getByRole("button").evaluateAll(buttons => {
    const tops = buttons.map(button => button.getBoundingClientRect().top);
    return Math.max(...tops) - Math.min(...tops);
  })).toBeLessThan(1);
  await expect(panel).toHaveCSS("background-color", /^rgb\(\d+, \d+, \d+\)$/u);
  await expect(panel).toHaveCSS("backdrop-filter", "none");
  await assertUnobstructed(tiers.getByRole("button", { name: "4K", exact: true }));
  await expect(size.locator('option[value="3840x2160"]')).toContainText("4K · 16:9 · 3840 × 2160");
  await shot("image-parameters-tiers");
  await assertUnobstructed(width);
  await assertUnobstructed(height);
  await expect(width).toHaveValue("3840"); await expect(height).toHaveValue("2160");
  await shot("image-parameters-dimensions");
  await assertUnobstructed(quality); await expect(quality).toHaveValue("max");
  await shot("image-parameters-quality");
  const picker = panel.getByRole("combobox", { name: "完整图片参数 模型", exact: true });
  await picker.click();
  await expect(panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true })).toBeVisible();
  await expect(panel.getByRole("listbox").getByRole("option").first()).toHaveAttribute("aria-setsize", "13");
  await shot("model-picker");
  await page.keyboard.press("Escape");
  await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
  await inspector.click();
  await expect(page.getByRole("textbox", { name: "创作任务要求", exact: true })).toBeVisible();
  await shot("agent");
  await inspector.click();
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await page.waitForTimeout(550);
  const source = page.locator('.react-flow__node[data-id="asset"] .react-flow__handle.source[data-port-kind="image"]');
  const sourceBox = await source.boundingBox(); expect(sourceBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down(); await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 4, sourceBox!.y + sourceBox!.height / 2);
  await expect(page.locator('.react-flow__node[data-id="parameters"] .node-card')).toHaveAttribute("data-connection-highlight", "compatible");
  const compatiblePort = page.locator('.react-flow__node[data-id="parameters"] .react-flow__handle.target[data-port-kind="image[]"]');
  await expect(compatiblePort).toHaveAttribute("data-connection-compatible", "true");
  const heldPortStyles = await compatiblePort.evaluate(element => {
    const style = getComputedStyle(element);
    return { interacting: Boolean(element.closest(".is-interacting")), scale: style.scale,
      background: style.backgroundColor, shadow: style.boxShadow };
  });
  surfaceStyles["connecting-compatible-port"] = heldPortStyles;
  expect(heldPortStyles).toMatchObject({ interacting: true, scale: "1.2", background: "rgb(45, 212, 191)" });
  expect(heldPortStyles.shadow).not.toBe("none");
  expect(heldPortStyles.shadow).toContain("4px");
  const incompatiblePort = page.locator('.react-flow__node[data-id="parameters"] .react-flow__handle.target[data-port-kind="text"]');
  await expect(incompatiblePort).toHaveAttribute("data-connection-active", "true");
  await expect(incompatiblePort).not.toHaveAttribute("data-connection-compatible", "true");
  await expect(incompatiblePort).toHaveCSS("opacity", "0.35");
  await expect(incompatiblePort).toHaveCSS("box-shadow", "none");
  await page.mouse.move(sourceBox!.x - 180, sourceBox!.y + 130, { steps: 8 });
  await shot("connecting-compatible");
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.press("Escape");
  await expect(page.locator(".connection-menu")).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await page.waitForTimeout(250); await shot("canvas-reduced-motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const messy = structuredClone(fixture.graph);
  const messyPositions = [[550, 50], [70, 720], [900, 500], [100, 200], [950, 80], [400, 600], [700, 330], [60, 60], [1140, 700], [500, 360], [1140, 250], [220, 470]];
  messy.nodes.forEach((node, i) => { const [x, y] = messyPositions[i]!; node.position = { x: x!, y: y! }; });
  const messyResponse = await request.post("/api/canvas", { data: { title: "一键整理 · 隔离乱图", graph: messy } });
  expect(messyResponse.ok()).toBeTruthy(); const messyCanvas = await messyResponse.json();
  await page.goto(`/canvas/${messyCanvas.id}`);
  if ((await inspector.getAttribute("aria-expanded")) === "true") await inspector.click();
  await page.getByRole("button", { name: "Fit View", exact: true }).click(); await page.waitForTimeout(450);
  await shot("layout-messy");
  await page.getByRole("button", { name: "一键整理画布", exact: true }).click();
  await page.waitForTimeout(650);
  await shot("layout-arranged");
  const emptyResponse = await request.post("/api/canvas", { data: { title: "空白创作入口 · 隔离视觉基准", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] } } });
  expect(emptyResponse.ok()).toBeTruthy(); const empty = await emptyResponse.json();
  await page.goto(`/canvas/${empty.id}`);
  await expect(page.locator(".canvas-empty-state")).toBeVisible();
  await shot("empty-canvas");
  expect(submissions).toBe(0); expect(externalRequests).toBe(0); expect(errors).toEqual([]);
  const report = { phase, viewport, timestamp: new Date().toISOString(), browser: page.context().browser()?.version(),
    fixture: { nodes: 12, statuses: ["queued", "running", "succeeded", "failed"], fakeStateNodes: 8, uiOnlyParameterNode: 1, models: 12, generationSubmissions: submissions, externalRequests },
    aura: { ...aura, reducedMotionPaused: true, visibilityEventPaused: true }, errors, warnings, surfaceStyles, screenshots };
  const path = join(output!, `${phase}-screenshots.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach("phase2-visual-evidence", { path, contentType: "application/json" });
});
