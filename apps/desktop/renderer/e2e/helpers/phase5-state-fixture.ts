import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { createCanvasStateVisualFixture } from "./canvas-state-visual-fixture";

export async function installPhase5StateFixture(page: Page, request: APIRequestContext, zoom = .8) {
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  let imageBuffer: Buffer | undefined;
  if (process.env.UI_PHASE5_VISUAL_ASSET_DIR) {
    const { loadPhase3VisualAssets } = await import("./phase3-visual-assets");
    const visual = await loadPhase3VisualAssets(process.env.UI_PHASE5_VISUAL_ASSET_DIR);
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
  await page.route("**/api/suppliers/catalog-upgrade", route => route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } }));
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [f.connection, f.fake] }) : route.continue());
  await page.route(`**/api/providers/${f.connection.id}/models*`, route => route.fulfill({ json: f.models,
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  await page.route(`**/api/providers/${f.fake.id}/models*`, route => route.fulfill({ json: [{ id: "fake-image-v1", name: "Fake",
    operations: ["image.generate"], inputKinds: ["text", "image"], outputKinds: ["image"] }], headers: { "X-Model-Scan-Status": "live" } }));
  await page.route("**/api/agent/models", route => route.fulfill({ json: [] }));
  await page.route("**/api/agent/sessions", route => route.fulfill({ json: [] }));
  const check = () => { expect(errors).toEqual([]); expect(warnings).toEqual([]); expect(submissions).toBe(0); expect(outbound).toBe(0); };
  return { ...f, errors, warnings, check, counters: () => ({ submissions, outbound }) };
}
