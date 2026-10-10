import assert from "node:assert/strict";

/** Fresh smoke profile only: the bundled CLI copies local fixtures and has no remote account. */
export async function smokeBundledVideo(api) {
  const template = await api("/api/providers/cli-template");
  assert.match(template.executable, /node\.exe$/iu);
  assert.equal(template.args.length, 1);
  assert.match(template.args[0].replaceAll("\\", "/"), /\/packages\/providers\/examples\/mock-cli\.mjs$/u);
  const connection = await api("/api/providers", { provider: "cli", name: "离线视频工具验收", config: { cli: {
    version: 1, siteId: "packaged-offline-video", siteName: "离线固定视频", enabled: true,
    ...template, pollIntervalMs: 100,
  } } });
  await api(`/api/providers/${connection.id}/cli`, { action: "describe" });
  const canvas = await api("/api/canvas", { title: "桌面视频离线验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [
      { id: "video-smoke", type: "workflow", position: { x: 0, y: 0 }, data: {
        nodeType: "video-generation", label: "离线视频", provider: "cli", connectionId: connection.id,
        model: "mock-video-v1", parts: [{ type: "text", text: "固定本地测试片段" }],
        parameters: { resolution: "480p", duration: 2, aspectRatio: "16:9", generateAudio: false },
        outputs: [{ id: "video", kind: "video" }],
      } },
    ],
  } });
  const submitted = await api("/api/runs", { canvasId: canvas.id, clientRequestId: crypto.randomUUID(), scope: "all" });
  let run;
  for (let attempt = 0; attempt < 100; attempt++) {
    run = await api(`/api/runs/${submitted.run.id}`);
    if (!["queued", "running"].includes(run.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(run.run.status, "succeeded", `Bundled video inspection must succeed without system FFmpeg: ${JSON.stringify(run)}`);
  const node = run.nodes.find(item => item.nodeId === "video-smoke");
  assert.equal(node.request.provider, "cli");
  const asset = await api(`/api/assets/${node.outputAssetIds[0]}`);
  assert.equal(asset.mimeType, "video/webm");
  assert.equal(asset.metadata.videoMediaVerified, true);
  assert.equal(asset.metadata.width, 854);
  assert.equal(asset.metadata.height, 480);
  assert.ok(Math.abs(asset.metadata.durationSeconds - 2) < 0.1);
  assert.equal(asset.metadata.audioTrackPresent, false);
  return { provider: "bundled-offline-cli", width: asset.metadata.width, height: asset.metadata.height,
    duration: asset.metadata.durationSeconds, videoMediaVerified: asset.metadata.videoMediaVerified,
    audioTrackPresent: asset.metadata.audioTrackPresent };
}
