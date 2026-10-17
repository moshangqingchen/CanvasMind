import { expect, test } from "./helpers/canvas-offline-test";
import { openWorkspaceProject } from "./helpers/workspace-navigation";
import { agentPanel } from "./helpers/agent-controls";

test("已保存的三节点画布查看助手与排序菜单再返回，不新增自动保存版本", async ({ page, request }) => {
  await page.addInitScript(() => {
    localStorage.setItem("super-canvas:inspector-open", "false");
    localStorage.setItem("super-canvas:gentle-motion", "off");
  });
  const created = await request.post("/api/canvas", { data: { title: "只读查看 · 隔离三节点", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: .8 }, edges: [], drawings: [],
    nodes: Array.from({ length: 3 }, (_, index) => ({ id: `view-only-${index}`, type: "workflow", position: { x: 50 + index * 340, y: 150 },
      data: { nodeType: "prompt", label: `构思 ${index + 1}`, parts: [{ type: "text", text: "已保存的创作构思" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } })),
  } } });
  expect(created.status()).toBe(201);
  const canvas = await created.json() as { id: string };
  let puts = 0, forbidden = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", event => {
    const url = new URL(event.url());
    if (url.pathname === `/api/canvas/${canvas.id}` && event.method() === "PUT") puts++;
  });
  await page.route("**/api/agent/**", route => {
    if (route.request().method() !== "GET") { forbidden++; return route.abort(); }
    const path = new URL(route.request().url()).pathname;
    return path === "/api/agent/models" || path === "/api/agent/sessions" ? route.fulfill({ json: [] }) : route.fallback();
  });
  await page.route("**/api/runs*", route => {
    if (route.request().method() !== "GET") { forbidden++; return route.abort(); }
    return route.continue();
  });
  await page.goto(`/canvas/${canvas.id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
  // Prepare an already-used saved canvas, including measured node geometry,
  // with an explicit save. The read-only check starts after this preparation.
  const prepared = page.waitForResponse(response => new URL(response.url()).pathname === `/api/canvas/${canvas.id}` && response.request().method() === "PUT");
  await page.keyboard.press("Control+s");
  expect((await prepared).ok()).toBe(true);
  await page.getByRole("button", { name: "返回主界面", exact: true }).click();
  await expect(page.getByTestId("neural-workspace")).toBeVisible();
  const baseline = await (await request.get(`/api/canvas/${canvas.id}`)).json();
  const preparedPuts = puts;
  await openWorkspaceProject(page, canvas.id);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await agentPanel(page).getByRole("button", { name: "对话模型", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "选择对话模型", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "排列顺序", exact: true }).click();
  await expect(page.getByRole("menu", { name: "排列顺序", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回主界面", exact: true }).click();
  await expect(page.getByTestId("neural-workspace")).toBeVisible();
  const after = await (await request.get(`/api/canvas/${canvas.id}`)).json();
  expect(puts).toBeGreaterThan(preparedPuts); // The normal durability flush still ran.
  expect(after).toEqual(baseline);
  expect(forbidden).toBe(0);
  expect(errors).toEqual([]);
});
