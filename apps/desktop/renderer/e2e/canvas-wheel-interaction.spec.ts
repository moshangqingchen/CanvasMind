import { expect, test, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";

type WheelSample = { trusted: boolean; interacting: boolean; motionDisplay: string; dashState: string; dashAnimation: string };
type WheelFeedbackProbe = { samples: WheelSample[]; interactionMutations: number; parameterWheels: number };
declare global { interface Window { __wheelFeedbackProbe?: WheelFeedbackProbe } }

const model: ModelDescriptor = {
  id: "fake-wheel-image", name: "隔离滚轮图片模型", operations: ["image.generate"],
  inputKinds: ["text"], outputKinds: ["image"], metadata: { canvasRunnable: true },
  parameters: [
    { key: "size", label: "精确尺寸", control: "dimensions", valueType: "string", default: "2048x2048",
      min: 256, max: 4096, step: 1, allowCustomValue: true, options: [
        { label: "自动", value: "auto" }, { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
        { label: "2K · 1:1 · 2048 × 2048", value: "2048x2048" }, { label: "4K · 1:1 · 4096 × 4096", value: "4096x4096" },
      ] },
    { key: "quality", label: "质量", control: "select", valueType: "string", default: "max", options: [{ label: "最高", value: "max" }] },
    ...Array.from({ length: 16 }, (_, index) => ({ key: `scroll_${index}`, label: `隔离参数 ${index + 1}`,
      control: "select" as const, valueType: "string" as const, default: "first", options: [{ label: "第一档", value: "first" }] })),
  ],
};

/** All API responses are local mocks; this fixture never opens a supplier connection. */
async function fixture(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("super-canvas:inspector-open", "false");
    localStorage.setItem("super-canvas:gentle-motion", "on");
  });
  const id = "wheel-feedback-isolated";
  const connection = { id: "fake-wheel", name: "隔离滚轮连接", provider: "fake", apiKey: "", apiKeySet: false,
    config: { usage: "canvas", defaultModel: model.id, connector: { auth: { type: "none" }, models: [model] } } };
  const canvas = { id, title: "缩放交互降级回归", revision: 1, graph: {
    schemaVersion: 1, viewport: { x: 20, y: 20, zoom: .85 },
    nodes: [
      { id: "wheel-prompt", type: "workflow", position: { x: 140, y: 220 }, style: { width: 280, height: 180 },
        data: { nodeType: "prompt", label: "滚轮提示词", parts: [{ type: "text", text: "纯界面回归，不生成" }],
          inputs: [], outputs: [{ id: "text", kind: "text", label: "文本" }] } },
      { id: "wheel-image", type: "workflow", position: { x: 660, y: 280 }, style: { width: 360, height: 260 },
        data: { nodeType: "image-generation", label: "滚轮图像", provider: "fake", connectionId: connection.id,
          model: model.id, qualityMode: "custom", parameters: { size: "2048x2048", quality: "max" }, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } },
    ],
    edges: [{ id: "wheel-edge", source: "wheel-prompt", sourceHandle: "text", target: "wheel-image", targetHandle: "prompt" }],
  } };
  const errors: string[] = [];
  let external = 0, submissions = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && !["data:", "blob:", "about:"].includes(url.protocol)) {
      external++; return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() === "POST" && ["/api/runs", "/api/agent/turn"].includes(url.pathname)) {
      submissions++; return route.fulfill({ status: 400, json: { error: "This UI fixture never submits" } });
    }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [{ id, title: canvas.title,
      nodeCount: 2, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z" }] } });
    if (url.pathname === `/api/canvas/${id}`) {
      if (request.method() === "PUT") { canvas.graph = request.postDataJSON().graph; canvas.revision++; }
      return route.fulfill({ json: canvas });
    }
    if (url.pathname === "/api/providers") return route.fulfill({ json: [connection] });
    if (url.pathname === `/api/providers/${connection.id}/models`) return route.fulfill({ json: [model],
      headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
    if (["/api/suppliers", "/api/assets", "/api/runs", "/api/agent/models", "/api/agent/sessions", "/api/integrations/material-drops"].includes(url.pathname)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], messages: [], sessions: [], groups: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${id}`);
  const wrap = page.locator(".canvas-wrap");
  await expect(page.locator('.react-flow__node[data-id="wheel-prompt"] .node-title')).toBeVisible();
  await page.locator('.react-flow__node[data-id="wheel-prompt"] .node-title').click();
  await expect(page.locator('.studio-edge-motion[data-edge-id="wheel-edge"]')).toHaveCount(1);
  await expect(wrap).not.toHaveClass(/is-interacting/);
  return { wrap, check: () => expect({ external, submissions, errors }).toEqual({ external: 0, submissions: 0, errors: [] }) };
}

async function observeWheelFeedback(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".canvas-wrap")!;
    const motion = root.querySelector<HTMLElement>('.studio-edge-motion[data-edge-id="wheel-edge"]')!;
    const dash = motion.querySelector<SVGPathElement>(".studio-edge-dash")!;
    const probe: WheelFeedbackProbe = { samples: [], interactionMutations: 0, parameterWheels: 0 };
    window.__wheelFeedbackProbe = probe;
    // Registered after the component's effect, on the same capture target. The
    // sample is synchronous, so a fast 160ms gesture cannot evade assertions.
    root.addEventListener("wheel", event => {
      probe.samples.push({ trusted: event.isTrusted, interacting: root.classList.contains("is-interacting"),
        motionDisplay: getComputedStyle(motion).display, dashState: getComputedStyle(dash).animationPlayState,
        dashAnimation: getComputedStyle(dash).animationName });
    }, { capture: true, passive: true });
    new MutationObserver(records => {
      probe.interactionMutations += records.filter(record => root.classList.contains("is-interacting") || record.oldValue?.includes("is-interacting")).length;
    }).observe(root, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    document.addEventListener("wheel", event => {
      if (event.target instanceof Element && event.target.closest(".canvas-parameter-dock")) probe.parameterWheels++;
    }, { capture: true, passive: true });
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`真实滚轮缩放在D3截断前降级，结束恢复并遵守减少动态效果（${reducedMotion}）`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const f = await fixture(page);
    const motion = page.locator('.studio-edge-motion[data-edge-id="wheel-edge"]');
    const dash = motion.locator(".studio-edge-dash");
    if (reducedMotion === "reduce") { await expect(motion).toBeHidden(); await expect(dash).toHaveCSS("animation-name", "none"); }
    else { await expect(motion).toBeVisible(); await expect(dash).toHaveCSS("animation-name", "edge-running-dash"); }
    await observeWheelFeedback(page);
    await page.mouse.move(500, 740);
    expect(await page.evaluate(() => document.elementFromPoint(500, 740)?.classList.contains("react-flow__pane"))).toBe(true);
    const before = await page.locator(".react-flow__viewport").getAttribute("style");
    await page.mouse.wheel(0, -180);
    await expect.poll(() => page.evaluate(() => window.__wheelFeedbackProbe!.samples.length)).toBeGreaterThan(0);
    const samples = await page.evaluate(() => window.__wheelFeedbackProbe!.samples);
    expect(samples.every(sample => sample.trusted && sample.interacting && sample.motionDisplay === "none" && sample.dashState === "paused")).toBe(true);
    await expect.poll(() => page.locator(".react-flow__viewport").getAttribute("style")).not.toBe(before);
    await expect.poll(() => page.evaluate(() => window.__wheelFeedbackProbe!.interactionMutations)).toBeGreaterThan(0);
    await expect(f.wrap).not.toHaveClass(/is-interacting/);
    if (reducedMotion === "reduce") { await expect(motion).toBeHidden(); await expect(dash).toHaveCSS("animation-name", "none"); }
    else {
      await expect(motion).toBeVisible();
      await expect(dash).toHaveCSS("animation-play-state", "running");
      const offset = await dash.evaluate(element => getComputedStyle(element).strokeDashoffset);
      await expect.poll(() => dash.evaluate(element => getComputedStyle(element).strokeDashoffset)).not.toBe(offset);
    }
    f.check();
  });
}

test("根级参数卡真实滚动不触发画布交互降级或缩放", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const f = await fixture(page);
  await page.getByRole("button", { name: "打开 滚轮图像 模型与参数", exact: true }).click();
  const panel = page.locator('.node-config-docked[data-config-node-id="wheel-image"]');
  const body = panel.locator(".node-config-popover-body");
  await expect(panel.getByLabel("图片宽度", { exact: true })).toBeEditable();
  expect(await panel.evaluate(element => element.closest(".canvas-wrap") === null)).toBe(true);
  await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  await body.evaluate(element => { element.scrollTop = 0; });
  await expect(f.wrap).not.toHaveClass(/is-interacting/);
  await observeWheelFeedback(page);
  const before = await page.locator(".react-flow__viewport").getAttribute("style");
  const box = (await body.boundingBox())!;
  const point = { x: box.x + 8, y: box.y + box.height / 2 };
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".node-config-popover-body")), point)).toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 320);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__wheelFeedbackProbe!.parameterWheels)).toBeGreaterThan(0);
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  expect(await page.evaluate(() => ({ samples: window.__wheelFeedbackProbe!.samples,
    interactionMutations: window.__wheelFeedbackProbe!.interactionMutations }))).toEqual({ samples: [], interactionMutations: 0 });
  await expect(f.wrap).not.toHaveClass(/is-interacting/);
  expect(await page.locator(".react-flow__viewport").getAttribute("style")).toBe(before);
  f.check();
});
