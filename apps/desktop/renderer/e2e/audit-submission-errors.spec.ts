import { expect, test } from "./helpers/canvas-offline-test";

for (const definite of [true, false]) test(definite ? "明确预检拒绝释放 journal 且不提示可能扣费" : "无明确标记的503保留 journal 和未知提交保护", async ({ page, request }) => {
  const created = await request.post("/api/canvas", { data: { title: `拒绝对照-${definite}-${Date.now()}`, graph: {
    schemaVersion: 1, nodes: [{ id: "source", type: "workflow", position: { x: 100, y: 100 }, data: {
      nodeType: "image-generation", label: "拒绝测试", provider: "fake", connectionId: "fake-default", model: "fake-image-v1",
      parts: [{ type: "text", text: "local fixture only" }], parameters: { n: 1 }, inputs: [], outputs: [{ id: "images", kind: "image", label: "图片" }],
    } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  } } });
  expect(created.ok()).toBe(true);
  const canvas = await created.json();
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() !== "POST") return route.continue();
    submissions++;
    return route.fulfill({ status: 503, json: { error: definite ? "免费目录预检失败，本次未提交" : "服务响应未知",
      ...(definite ? { code: "RUN_PREFLIGHT_REJECTED", submissionPhase: "not_started" } : {}) } });
  });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "运行 拒绝测试 节点", exact: true }).click();
  const status = definite ? "failed" : "needs_attention";
  await expect(page.locator(`[data-generated-status="${status}"]`)).toHaveCount(1);
  const records = await page.evaluate(id => JSON.parse(localStorage.getItem(`super-canvas:submissions:v1:${id}`) ?? "[]"), canvas.id);
  expect(records.length).toBe(definite ? 0 : 1);
  if (definite) await expect(page.getByText(/提交结果未知/u)).toHaveCount(0);
  expect(submissions).toBe(1); // One browser attempt; the fixture never invokes generation.
  expect(await (await request.get(`/api/runs?canvasId=${canvas.id}`)).json()).toEqual([]);
});
