import { expect, test } from "@playwright/test";
import { clickBlankCanvas } from "./canvas-test-actions";

test.use({ video: process.env.STUDIO_RECORD_VIDEO === "1" ? { mode: "on", size: { width: 1600, height: 1000 } } : "off" });

test("studio canvas keeps navigation, view toggles and draft starters usable", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  let agentTurns = 0;
  await page.route("**/api/agent/turn", (route) => { agentTurns++; return route.abort("blockedbyclient"); });
  const created = await request.post("/api/projects", { data: { title: "灵感工作室" } });
  expect(created.ok()).toBeTruthy();
  const { project } = await created.json();
  expect((await request.post("/api/providers", { data: { name: "离线界面验收", provider: "fake", apiKey: "local-test-only", config: {
    connector: { auth: { type: "none" }, models: [{ id: "fake-image-v1", name: "离线图片", operations: ["image.generate"] }] },
  } } })).ok()).toBeTruthy();
  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByText("让灵感，在这里发生")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开超级导演", exact: true })).toHaveCount(0);
  const assistant = page.getByRole("region", { name: "通用创作智能体" });
  await expect(assistant.getByRole("heading", { name: "有什么想法，聊聊吧。", exact: true })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "聊天", exact: true })).toHaveAttribute("aria-pressed", "true");
  // A canvas starter fills a draft; it must not inherit a previously selected production mode.
  await assistant.getByRole("button", { name: "制作画布方案", exact: true }).click();
  await page.getByRole("button", { name: "创作分镜", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "创作任务要求" })).toHaveValue(/请帮我创作一组分镜/);
  await expect(assistant.getByRole("button", { name: "聊天", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(agentTurns).toBe(0);
  await page.getByRole("textbox", { name: "创作任务要求" }).fill("");
  await page.screenshot({ path: testInfo.outputPath("studio-empty.png") });

  await page.getByRole("button", { name: "小地图", exact: true }).click();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await page.getByRole("button", { name: "小地图", exact: true }).click();
  await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  await page.getByRole("button", { name: "显示连线", exact: true }).click();
  await expect(page.getByRole("button", { name: "显示连线", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "显示连线", exact: true }).click();

  await page.getByRole("button", { name: "新建图片节点", exact: true }).click();
  await expect(page.locator(".node-card[data-node-type='image-generation']")).toBeVisible();
  await page.getByRole("button", { name: "新建提示词节点", exact: true }).click();
  await expect(page.locator(".node-card[data-node-type='prompt']")).toBeVisible();
  await expect(page.getByRole("tab", { name: "节点参数", exact: true })).toHaveCount(0);
  await expect(page.locator("#inspector-node-panel")).toHaveCount(0);
  await expect(page.locator(".inspector .agent-panel")).toBeVisible();
  await page.getByRole("button", { name: "一键整理画布", exact: true }).click();
  await expect(page.getByRole("button", { name: "智能体面板", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".inspector")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("studio-nodes.png") });
  await page.getByRole("button", { name: "打开节点与素材库", exact: true }).click();
  await expect(page.locator("aside.sidebar")).toBeVisible();
  await page.getByRole("button", { name: "关闭素材库", exact: true }).click();
  await expect(page.locator("aside.sidebar")).toBeHidden();

  await page.setViewportSize({ width: 760, height: 800 });
  await page.reload();
  await expect(page.locator(".inspector")).toBeHidden();
  await page.getByRole("button", { name: "智能体面板", exact: true }).click();
  await expect(page.locator(".inspector")).toBeVisible();
  await expect(page.locator(".inspector")).toHaveCSS("opacity", "1");
  const panel = await page.locator(".inspector").boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(760);
  await page.screenshot({ path: testInfo.outputPath("studio-compact.png") });
});

test("only selected connections have continuous feathered light, switching and clearing selection updates it", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const graph = {
    schemaVersion: 1,
    nodes: [
      { id: "idea", type: "workflow", position: { x: 120, y: 260 }, data: { nodeType: "prompt", label: "创意描述", parts: [{ type: "text", text: "一片紫色晨雾中的森林，柔和的光线与电影感构图" }], inputs: [], outputs: [{ id: "prompt", kind: "text", label: "Prompt" }] } },
      { id: "image", type: "workflow", position: { x: 850, y: 150 }, data: { nodeType: "image-generation", label: "视觉探索", provider: "fake", model: "fake-image-v1", connectionId: "fake-default", parts: [], inputs: [{ id: "prompt", kind: "text", label: "Prompt" }], outputs: [{ id: "images", kind: "image", label: "图片" }], parameters: {} } },
      { id: "story", type: "workflow", position: { x: 850, y: 550 }, data: { nodeType: "prompt", label: "镜头叙事", parts: [], inputs: [{ id: "prompt", kind: "text", label: "Prompt" }], outputs: [{ id: "prompt", kind: "text", label: "Prompt" }] } },
    ],
    edges: [
      { id: "idea-image", source: "idea", sourceHandle: "prompt", target: "image", targetHandle: "prompt", type: "smoothstep" },
      { id: "idea-story", source: "idea", sourceHandle: "prompt", target: "story", targetHandle: "prompt", type: "smoothstep" },
    ], viewport: { x: 10, y: 20, zoom: .88 },
  };
  const created = await request.post("/api/canvas", { data: { title: "森林序曲 · 视觉创作", graph } });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.goto(`/canvas/${project.id}`);
  await expect(page.locator(".studio-edge")).toHaveCount(2);
  const edge = page.locator('.react-flow__edge[data-id="idea-image"]');
  const otherEdge = page.locator('.react-flow__edge[data-id="idea-story"]');
  const signal = edge.locator(".studio-edge-signal");
  const light = edge.locator(".studio-edge-light");
  const offset = () => light.evaluate((element) => getComputedStyle(element).offsetDistance);
  // Hover is not selection. An idle canvas has no animated beams at all.
  await expect(page.locator(".studio-edge.is-focused")).toHaveCount(0);
  await expect(page.locator(".studio-edge-beam")).toHaveCount(0);
  await edge.locator(".react-flow__edge-interaction").hover();
  await expect(page.locator(".studio-edge-beam")).toHaveCount(0);
  await page.locator('.react-flow__node[data-id="image"] .node-title').click();
  await expect(edge.locator(".studio-edge-beam")).toHaveCount(1);
  await expect(otherEdge.locator(".studio-edge-beam")).toHaveCount(0);
  await expect(light).toHaveCSS("animation-name", "studio-edge-flow");
  await expect(light).toHaveCSS("animation-duration", "3.6s");
  // A single continuous stroke is feathered by a moving vector gradient, not stacked hard dashes.
  await expect(signal).toHaveCSS("stroke-dasharray", "none");
  await expect(signal).toHaveCSS("vector-effect", "non-scaling-stroke");
  await expect(edge.locator("mask radialGradient, defs > radialGradient")).toHaveCount(1);
  const initialOffset = await offset();
  await expect.poll(offset).not.toBe(initialOffset);
  // Sample individual frames to reject animations that just jump between endpoints.
  const samples = await light.evaluate(async (element) => {
    const values: number[] = [];
    for (let frame = 0; frame < 6; frame++) {
      await new Promise(requestAnimationFrame);
      values.push(Number.parseFloat(getComputedStyle(element).offsetDistance));
    }
    return values;
  });
  expect(new Set(samples).size).toBeGreaterThan(3);
  await expect(page.getByRole("button", { name: "画布动效", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => Number.parseFloat(await offset())).toBeGreaterThan(42);
  await page.screenshot({ path: testInfo.outputPath("studio-selected-flow.png") });
  if (process.env.STUDIO_RECORD_VIDEO === "1") await page.waitForTimeout(3700);

  await page.locator('.react-flow__node[data-id="story"] .node-title').click();
  await expect(edge.locator(".studio-edge-beam")).toHaveCount(0);
  await expect(otherEdge.locator(".studio-edge-beam")).toHaveCount(1);
  if (process.env.STUDIO_RECORD_VIDEO === "1") await page.waitForTimeout(3700);
  await clickBlankCanvas(page);
  await expect(page.locator(".studio-edge-beam")).toHaveCount(0);
  // Clicking an edge lights that edge alone; clicking its source lights both outgoing edges.
  await edge.locator(".react-flow__edge-interaction").click();
  await expect(edge.locator(".studio-edge-beam")).toHaveCount(1);
  await expect(otherEdge.locator(".studio-edge-beam")).toHaveCount(0);

  await page.getByRole("button", { name: "画布动效", exact: true }).click();
  await expect(light).toHaveCSS("animation-name", "none");
  await expect(edge.locator(".studio-edge-beam")).toBeHidden();
  const pausedOffset = await offset();
  // Sample across several frames to catch animations that only change their toggle's appearance.
  await page.waitForTimeout(250);
  expect(await offset()).toBe(pausedOffset);
  await page.getByRole("button", { name: "画布动效", exact: true }).click();
  await expect(light).toHaveCSS("animation-play-state", "running");
  await expect.poll(offset).not.toBe(pausedOffset);

  await page.locator('.react-flow__node[data-id="idea"] .node-title').click();
  await expect(page.locator(".studio-edge.is-focused")).toHaveCount(2);
  await expect(page.locator(".studio-edge-beam")).toHaveCount(2);
  expect(await page.locator('.react-flow__node[data-id="idea"] .node-card').evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(light).toHaveCSS("animation-name", "none");
  await expect(light).toHaveCSS("offset-distance", "55%");
  await page.screenshot({ path: testInfo.outputPath("studio-feathered-detail.png") });
  await page.getByRole("button", { name: "显示连线", exact: true }).click();
  await expect(page.locator(".react-flow__edges")).toHaveCSS("visibility", "hidden");
  await clickBlankCanvas(page);
  const saved = await (await request.get(`/api/canvas/${project.id}`)).json();
  expect(saved.graph.edges).toEqual(graph.edges);
});
