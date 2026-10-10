import { expect, test } from "@playwright/test";

test("真实模拟 CLI 从目录与参数运行到可播放视频，重复请求不重新生成", async ({ page, request }, testInfo) => {
  const templateResponse = await request.get("/api/providers/cli-template");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json();
  const savedResponse = await request.post("/api/providers", { data: {
    name: "离线 CLI 验收", provider: "cli", config: { cli: {
      version: 1, siteId: "mock", siteName: "模拟 AI 网站", accountLabel: "离线测试",
      ...template, enabled: true, commandTimeoutMs: 30000, submitTimeoutMs: 60000, pollIntervalMs: 100, taskTimeoutMs: 60000,
    } },
  } });
  expect(savedResponse.ok()).toBeTruthy();
  const connection = await savedResponse.json();
  const initialModels = await request.get(`/api/providers/${connection.id}/models?refresh=1`);
  expect(await initialModels.json()).toEqual([]);
  const tested = await request.post(`/api/providers/${connection.id}/cli`, { data: { action: "test" } });
  expect(tested.ok()).toBeTruthy();
  expect((await tested.json()).connection.config.cliStatus.state).toBe("ready");
  const described = await request.post(`/api/providers/${connection.id}/cli`, { data: { action: "describe" } });
  expect(described.ok()).toBeTruthy();
  const catalog = await described.json();
  expect(catalog.models.some((model: { id: string }) => model.id === "mock-video-v1")).toBe(true);

  const canvasResponse = await request.post("/api/canvas", { data: {
    title: "个人 AI 网站 · 视频闭环", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "cli-video", type: "workflow", position: { x: 200, y: 130 }, data: {
        nodeType: "video-generation", label: "个人网站视频", provider: "cli", connectionId: connection.id, model: "mock-video-v1",
        parts: [{ type: "text", text: "中文提示词：保留引号 \"测试\" 与换行\n只使用离线固定视频。" }],
        parameters: { resolution: "720p", duration: 2, aspectRatio: "16:9", generateAudio: false },
        inputs: [{ id: "prompt", kind: "text", label: "提示词", required: false }], outputs: [{ id: "video", kind: "video", label: "视频" }],
      },
    }] },
  } });
  expect(canvasResponse.ok()).toBeTruthy();
  const canvas = await canvasResponse.json();
  await page.goto(`/canvas/${canvas.id}`);
  await expect(page.getByRole("button", { name: "打开 个人网站视频 模型与参数", exact: true })).toContainText("模拟视频 · 固定测试片段");
  const submission = page.waitForResponse(response => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST");
  await page.getByRole("button", { name: "运行 个人网站视频 节点", exact: true }).click();
  const submitted = await submission;
  const runRequest = submitted.request().postDataJSON();
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  const snapshot = await submitted.json();
  const runId = snapshot.run?.id ?? snapshot.id;
  expect(runId).toBeTruthy();
  await expect.poll(async () => {
    const result = await (await request.get(`/api/runs/${runId}`)).json();
    return result.run.status;
  }, { timeout: 25000 }).toBe("succeeded");
  const finished = await (await request.get(`/api/runs/${runId}`)).json();
  const assetId = finished.nodes.find((node: { nodeId: string }) => node.nodeId === "cli-video").outputAssetIds[0];
  const media = await request.get(`/api/assets/${assetId}/content`);
  expect(media.headers()["content-type"]).toContain("video/webm");
  expect(Array.from((await media.body()).subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  const duplicate = await request.post("/api/runs", { data: runRequest });
  expect((await duplicate.json()).run.id).toBe(runId);
  const video = page.locator(`video[src*="${assetId}"]`).first();
  await expect(video).toBeAttached();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({ width: element.videoWidth, height: element.videoHeight })))
    .toEqual({ width: 1280, height: 720 });
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
  await page.reload();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({ width: element.videoWidth, height: element.videoHeight })))
    .toEqual({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath("personal-ai-video-playback.png") });
});
