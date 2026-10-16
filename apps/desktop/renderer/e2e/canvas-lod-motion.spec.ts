import { expect, test, type Page } from "@playwright/test";

type LodMotionAudit = {
  classWrites: number;
  wheels: number[];
  initialNodes: number;
  finalNodes: number;
  addedNodes: number;
  removedNodes: number;
  sameNodes: boolean;
};
type AuditedWindow = Window & { __stopLodMotionAudit?: () => LodMotionAudit };

async function startAudit(page: Page) {
  await page.evaluate(() => {
    const wrap = document.querySelector(".canvas-wrap")!;
    const nodes = document.querySelector(".react-flow__nodes")!;
    const original = Array.from(nodes.children);
    let classWrites = 0, addedNodes = 0, removedNodes = 0;
    const wheels: number[] = [];
    const classes = new MutationObserver(records => { classWrites += records.length; });
    classes.observe(wrap, { attributes: true, attributeFilter: ["class"] });
    const children = new MutationObserver(records => {
      for (const record of records) {
        addedNodes += Array.from(record.addedNodes).filter(node => node instanceof Element && node.matches(".react-flow__node")).length;
        removedNodes += Array.from(record.removedNodes).filter(node => node instanceof Element && node.matches(".react-flow__node")).length;
      }
    });
    children.observe(nodes, { childList: true });
    const wheel = (event: Event) => { wheels.push((event as WheelEvent).deltaY); };
    wrap.addEventListener("wheel", wheel, { capture: true, passive: true });
    (window as AuditedWindow).__stopLodMotionAudit = () => {
      classes.disconnect(); children.disconnect();
      wrap.removeEventListener("wheel", wheel, true);
      delete (window as AuditedWindow).__stopLodMotionAudit;
      return { classWrites, wheels, initialNodes: original.length, finalNodes: nodes.children.length,
        addedNodes, removedNodes, sameNodes: original.every(node => node.parentElement === nodes) };
    };
  });
}

async function zoom(page: Page) {
  return page.locator(".react-flow__viewport").evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
}

test("远景滚轮不反复改根交互样式，节点保持挂载且近景仍正常降级", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  const response = await request.post("/api/canvas", { data: {
    title: "隔离 LOD 交互样式回归",
    graph: { schemaVersion: 1, viewport: { x: 50, y: 80, zoom: 1 },
      nodes: [
        { id: "lod-source", type: "workflow", position: { x: 100, y: 180 },
          data: { nodeType: "prompt", label: "LOD 源节点", parts: [{ type: "text", text: "仅界面回归" }],
            inputs: [], outputs: [{ id: "out", kind: "text", label: "提示词" }] } },
        { id: "lod-target", type: "workflow", position: { x: 660, y: 220 },
          data: { nodeType: "prompt", label: "LOD 目标节点", parts: [{ type: "text", text: "不提交生成" }],
            inputs: [{ id: "in", kind: "text", label: "提示词" }], outputs: [{ id: "out", kind: "text", label: "提示词" }] } },
      ], edges: [{ id: "lod-edge", source: "lod-source", target: "lod-target", sourceHandle: "out", targetHandle: "in" }],
    },
  } });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/canvas/${(await response.json()).id}`);
  const source = page.locator('.react-flow__node[data-id="lod-source"]');
  await expect(source.locator(".node-head")).toBeVisible();
  const agent = page.getByRole("button", { name: /智能体面板/ });
  if (await agent.getAttribute("aria-expanded") === "true") await agent.click();
  await source.locator(".node-head").click();
  await expect(source).toHaveClass(/selected/);
  const light = page.locator('.studio-edge-motion[data-edge-id="lod-edge"] .studio-edge-light');
  await expect(light).toHaveCount(1);
  await expect(light.locator("ellipse")).toHaveCount(2);
  await expect(page.locator(".studio-edge-dash")).toHaveCount(0);
  const point = await page.locator(".react-flow__pane").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (const x of [.75, .6, .85]) for (const y of [.7, .8, .55]) {
      const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
      if (document.elementFromPoint(point.x, point.y) === element) return point;
    }
    return null;
  });
  expect(point, "应有真实可操作的空白画布").not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => zoom(page)).toBeLessThan(.3);
  const viewport = page.locator(".react-flow__viewport");
  const wrap = page.locator(".canvas-wrap");
  await expect(viewport).toHaveClass(/canvas-lod-compact/);
  await expect(wrap).not.toHaveClass(/is-interacting/);
  await expect(light).toHaveCSS("animation-play-state", "paused");
  await page.waitForTimeout(250);
  await startAudit(page);
  // Match the performance benchmark's real wheel sequence and trailing window.
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, i < 6 ? -60 : 60);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(180);
  const far = await page.evaluate(() => (window as AuditedWindow).__stopLodMotionAudit!());
  expect(far.wheels).toEqual(Array.from({ length: 12 }, (_, i) => i < 6 ? -60 : 60));
  expect(far.classWrites).toBe(0);
  expect(far).toMatchObject({ initialNodes: 2, finalNodes: 2, addedNodes: 0, removedNodes: 0, sameNodes: true });
  await expect(viewport).toHaveClass(/canvas-lod-compact/);
  await expect(wrap).not.toHaveClass(/is-interacting/);
  await expect(light).toHaveCSS("animation-play-state", "paused");

  await page.mouse.wheel(0, -1200);
  await expect(viewport).not.toHaveClass(/canvas-lod-compact/);
  await expect(wrap).not.toHaveClass(/is-interacting/);
  await expect(light).toHaveCSS("animation-play-state", "running");
  await startAudit(page);
  await page.mouse.wheel(0, -60);
  await expect(wrap).toHaveClass(/is-interacting/);
  await expect(wrap).not.toHaveClass(/is-interacting/);
  const near = await page.evaluate(() => (window as AuditedWindow).__stopLodMotionAudit!());
  expect(near.classWrites).toBe(2);
  expect(near.wheels).toEqual([-60]);
  expect(submissions).toBe(0);
});
