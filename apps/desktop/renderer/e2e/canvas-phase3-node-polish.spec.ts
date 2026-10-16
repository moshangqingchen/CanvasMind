import { expect, test } from "@playwright/test";

test("节点正文不被端口列挤窄，图标按钮统一且缺报价不留破折号", async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  let submissions = 0;
  await page.route("**/api/runs", route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  const created = await request.post("/api/canvas", { data: { title: "节点排版回归", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [
      { id: "polish-prompt", type: "workflow", position: { x: 100, y: 100 }, style: { width: 320, height: 220 },
        data: { nodeType: "prompt", label: "正文与端口", parts: [{ type: "text", text: "从左上角开始的提示词正文，保持完整可用的编辑宽度。" }],
          inputs: [{ id: "in", kind: "text", label: "输入" }], outputs: [{ id: "out", kind: "text", label: "输出" }] } },
      { id: "polish-generation", type: "workflow", position: { x: 520, y: 100 }, style: { width: 320, height: 250 },
        data: { nodeType: "image-generation", label: "待选型号", provider: "fake", model: "ui-only-without-quote", parameters: {}, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "image", kind: "image", label: "图片" }] } },
    ],
  } } });
  expect(created.ok()).toBeTruthy();
  await page.goto(`/canvas/${(await created.json()).id}`);
  const prompt = page.locator('.react-flow__node[data-id="polish-prompt"]');
  const generation = page.locator('.react-flow__node[data-id="polish-generation"]');
  await expect(prompt).toBeVisible();
  await expect(prompt.locator(".node-body")).toHaveCSS("text-align", "left");
  await expect(prompt.locator(".node-body")).toHaveCSS("padding-left", "12px");
  await expect(prompt.locator(".node-body")).toHaveCSS("padding-right", "12px");
  // Transient port capsules sit outside the handles and preserve the full body.
  await page.mouse.move(4, 4);
  await expect.poll(() => prompt.locator(".port-label").evaluateAll(labels => labels.every(label => {
    const s = getComputedStyle(label);
    return s.visibility === "hidden" && Number(s.opacity) === 0;
  }))).toBe(true);
  await prompt.locator(".node-head").hover();
  await expect.poll(() => prompt.evaluate(element => {
    const card = element.querySelector(".node-card")!.getBoundingClientRect();
    return Array.from(element.querySelectorAll(".port-label")).every(label => {
      const rect = label.getBoundingClientRect(), s = getComputedStyle(label);
      return s.visibility === "visible" && Number(s.opacity) === 1 && Number.parseFloat(s.borderRadius) >= 6 &&
        (label.classList.contains("left") ? rect.right < card.left : rect.left > card.right);
    });
  })).toBe(true);
  await expect(generation.locator(".node-config-summary")).toBeVisible();
  await expect(generation.locator(".node-model-price")).toHaveCount(0);
  await expect(generation.locator(".node-run-button")).toHaveCSS("width", "28px");
  await expect(generation.locator(".node-delete-button")).toHaveCSS("height", "28px");
  const toolbar = page.locator(".canvas-toolbar");
  // Aurora changes the surface hue; the floating toolbar must stay fully opaque and unblurred.
  await expect(toolbar).toHaveCSS("background-color", /^rgba\(\d+,\s*\d+,\s*\d+,\s*0\.\d+\)$/u);
  await expect(toolbar).toHaveCSS("backdrop-filter", /^blur\((?:12|22)px\) saturate\(1\.6\)$/u);
  await generation.locator(".node-delete-button").click();
  await expect(generation).toHaveCount(0);
  const deleted = page.locator(".toast").filter({ hasText: "已删除 1 个节点" });
  await deleted.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(generation).toBeVisible();
  // Exercise the 450ms edit-coalescing boundary deterministically: deletion
  // and the following text edit must still be two separate undo steps.
  await page.evaluate(() => { const now = Date.now(); Date.now = () => now; });
  await generation.locator(".node-delete-button").click();
  await prompt.locator(".prompt-overview").click();
  const editor = prompt.locator(".tiptap-prompt");
  await editor.fill("删除后的新修改"); await editor.press("Control+s");
  await expect(deleted).toHaveCount(0);
  await prompt.locator(".node-head").click();
  await page.keyboard.press("Control+z");
  await expect(generation).toHaveCount(0);
  await expect(prompt).toContainText("从左上角开始的提示词正文");
  expect(submissions).toBe(0);
});

test("拒绝本地偏好存储时画布与右栏宽度仍可使用", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  const created = await request.post("/api/canvas", { data: { title: "存储拒绝下的界面", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] } } });
  expect(created.ok()).toBeTruthy();
  await page.goto(`/canvas/${(await created.json()).id}`);
  const resize = page.getByRole("separator", { name: "调整右侧面板宽度", exact: true });
  await expect(resize).toBeVisible();
  const original = Number(await resize.getAttribute("aria-valuenow"));
  await resize.focus(); await page.keyboard.press("ArrowLeft");
  await expect(resize).toHaveAttribute("aria-valuenow", String(original + 20));
  await page.getByRole("button", { name: "智能体面板", exact: true }).click();
  await expect(resize).toBeHidden();
  expect(errors).toEqual([]);
});
