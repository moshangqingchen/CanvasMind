import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, restRequestRequiresPublicAssets, type RestConnectorConfig } from "./rest.js";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";

const request: NormalizedRequest = { connectionId: "cx-video", operation: "video.generate", model: "sd10-seedance-2.0", prompt: "blue vase", idempotencyKey: "paid-once", parameters: { duration: 10, aspect_ratio: "16:9", resolution: "720p" } };
function fixture(model = request.model!, fetch?: FetchImplementation, changed: Record<string, unknown> = {}) {
  // Old family-inherited transport intentionally has incorrect paths and refs.
  const connector: RestConnectorConfig = { auth: { type: "bearer" }, restrictModels: true,
    models: [{ id: model, name: model, operations: ["video.generate", "video.image-to-video"] }], pollIntervalMs: 1500,
    submit: { path: "/v1/videos", method: "POST", bodyMode: "json", template: { stale: true }, mappings: [{ target: "/duration", source: { kind: "request", path: "$.parameters.duration" } }, { target: "/image", source: { kind: "assets", assetKind: "image", select: "first" } }],
      response: { taskIdPath: "$.id", statusPath: "$.status" } },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.status" } },
    output: { path: "$.url", kind: "video" } };
  const settings = { modelGroup: "视频", defaultModel: model, scannedModelIds: [model], connector, ...changed };
  const fetchMock = vi.fn<FetchImplementation>(fetch ?? (async (_url, init) => Response.json(init?.method === "POST" ? { request_id: "task-123", status: "processing" }
    : { request_id: "task-123", status: "succeeded", data: [{ url: "https://assets.example/result.mp4" }] })));
  const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: request.connectionId, provider: "rest", apiKey: "fixture-key", baseUrl: "https://vapi.chuangxiangai.asia", settings }]), { fetch: fetchMock });
  return { adapter, fetchMock, settings, connector };
}

describe("current Chuangxiang video REST integration", () => {
  it("sends the documented duration field when loading a saved seconds alias and rejects conflicting aliases", async () => {
    const f = fixture();
    await f.adapter.submit({ ...request, parameters: { seconds: 10 } });
    expect(JSON.parse(String(f.fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ model: request.model, prompt: request.prompt, duration: 10, n: 1 });
    await expect(f.adapter.submit({ ...request, parameters: { seconds: 5, duration: 10 } })).rejects.toThrow(/必须一致/);
    expect(f.fetchMock).toHaveBeenCalledOnce();
  });

  it("repairs stale wire fields and submits all ordered reference images only once", async () => {
    const f = fixture();
    const task = await f.adapter.submit({ ...request, operation: "video.image-to-video", assets: [1, 2].map(index => ({ id: String(index), kind: "image", mimeType: "image/png", url: `https://assets.example/${index}.png` })) });
    expect(f.fetchMock).toHaveBeenCalledOnce();
    const [url, init] = f.fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://vapi.chuangxiangai.asia/v1/videos/generations");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model: request.model, prompt: request.prompt, duration: 10, aspect_ratio: "16:9", resolution: "720p", n: 1,
      reference_image_urls: ["https://assets.example/1.png", "https://assets.example/2.png"] });
    expect(task).toMatchObject({ providerTaskId: "task-123", status: "running", pollAfterMs: 10000 });
    expect((task.result as Record<string, unknown>).model).toBe(request.model);
    const state = await f.adapter.poll(JSON.parse(JSON.stringify(task)));
    expect(String(f.fetchMock.mock.calls[1]![0])).toBe("https://vapi.chuangxiangai.asia/v1/videos/generations/task-123");
    expect(state.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", mimeType: "video/mp4", url: "https://assets.example/result.mp4" }]);
  });

  it("maps separate video/audio reference arrays for supported SD11 channels", async () => {
    const f = fixture("sd11-seedance-2.0");
    await f.adapter.submit({ ...request, model: "sd11-seedance-2.0", assets: [
      { id: "image", kind: "image", mimeType: "image/png", role: "reference", url: "https://assets.example/a.png" },
      { id: "video", kind: "video", mimeType: "video/mp4", url: "https://assets.example/b.mp4" },
      { id: "audio", kind: "audio", mimeType: "audio/mpeg", url: "https://assets.example/c.mp3" },
    ] });
    expect(JSON.parse(String(f.fetchMock.mock.calls[0]![1]?.body))).toMatchObject({ reference_image_urls: ["https://assets.example/a.png"], reference_videos: ["https://assets.example/b.mp4"], reference_audios: ["https://assets.example/c.mp3"] });
  });

  it("uses Veo's 4/6/8 seconds and first/last fields rather than reference arrays", async () => {
    const f = fixture("ve1-veo-3.1-fast");
    for (const duration of [4, 6, 8]) {
      await f.adapter.submit({ ...request, model: "ve1-veo-3.1-fast", operation: "video.image-to-video", parameters: { duration, resolution: "1080p", aspect_ratio: "9:16" }, assets: [
        { id: "first", kind: "image", mimeType: "image/png", role: "firstFrame", url: "https://assets.example/first.png" },
        { id: "last", kind: "image", mimeType: "image/png", role: "lastFrame", url: "https://assets.example/last.png" },
      ] });
      const body = JSON.parse(String(f.fetchMock.mock.calls.at(-1)![1]?.body));
      expect(body).toMatchObject({ duration, first_image_url: "https://assets.example/first.png", last_image_url: "https://assets.example/last.png" });
      expect(body).not.toHaveProperty("reference_image_urls");
    }
    await expect(f.adapter.submit({ ...request, model: "ve1-veo-3.1-fast", parameters: { duration: 5 } })).rejects.toThrow(/4 \/ 6 \/ 8/);
    expect(f.fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid SD10 durations, counts, unsupported references and unsafe URLs before paid submit", async () => {
    const f = fixture();
    for (const parameters of [{ duration: -1 }, { duration: 8 }, { duration: 10, n: 2 }]) await expect(f.adapter.submit({ ...request, parameters })).rejects.toThrow(/invalid/);
    await expect(f.adapter.submit({ ...request, assets: Array.from({ length: 10 }, (_, index) => ({ id: String(index), kind: "image", mimeType: "image/png", url: `https://assets.example/${index}.png` })) })).rejects.toThrow(/最多接受 9/);
    for (const kind of ["video", "audio"] as const) await expect(f.adapter.submit({ ...request, assets: [{ id: kind, kind, mimeType: `${kind}/mp4`, url: `https://assets.example/${kind}.mp4` }] })).rejects.toThrow(/不支持此类/);
    for (const url of ["http://assets.example/a.png", "https://127.0.0.1/a.png", "https://assets.example/v1/files/a", "data:image/png;base64,AQID"])
      await expect(f.adapter.submit({ ...request, assets: [{ id: "ref", kind: "image", mimeType: "image/png", url }] })).rejects.toThrow(/公网 HTTPS/);
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a long-running task and resumes the same ID for more than 30 minutes of poll intervals", async () => {
    let gets = 0;
    const f = fixture(undefined, async (_url, init) => {
      if (init?.method === "POST") return Response.json({ request_id: "long-task", status: "queued" });
      gets++;
      return Response.json(gets < 182 ? { status: "processing" } : { status: "succeeded", data: [{ url: "https://assets.example/result.mp4" }] });
    });
    let task = await f.adapter.submit(request);
    for (let index = 0; index < 182; index++) task = { ...task, ...await f.adapter.poll(JSON.parse(JSON.stringify(task))) };
    expect(task).toMatchObject({ providerTaskId: "long-task", status: "succeeded", pollAfterMs: 10000 });
    expect(f.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(f.fetchMock.mock.calls.slice(1).every(([url, init]) => String(url) === "https://vapi.chuangxiangai.asia/v1/videos/generations/long-task" && init?.method === "GET")).toBe(true);
  });

  it("repairs an old task's GET route without submitting it again", async () => {
    const f = fixture();
    const state = await f.adapter.poll({ providerTaskId: "saved-task", status: "running", result: { connectionId: request.connectionId, model: request.model, config: f.connector, remote: {}, taskId: "saved-task" } });
    expect(f.fetchMock).toHaveBeenCalledOnce();
    expect(String(f.fetchMock.mock.calls[0]![0])).toBe("https://vapi.chuangxiangai.asia/v1/videos/generations/saved-task");
    expect(state).toMatchObject({ providerTaskId: "saved-task", pollAfterMs: 10000 });
  });

  it("fails ambiguous submissions without repeating a POST and preserves strict model restrictions", async () => {
    for (const response of [{ status: "processing" }, { request_id: "   ", status: "processing" }, { request_id: {}, status: "processing" }]) {
      const noId = fixture(undefined, async () => Response.json(response));
      await expect(noId.adapter.submit(request)).rejects.toMatchObject({ message: expect.stringMatching(/未返回视频任务 ID/),
        details: { kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true, responseBody: response } });
      expect(noId.fetchMock).toHaveBeenCalledOnce();
    }
    const rejected = fixture(undefined, async () => Response.json({ error: "UPSTREAM_BUSY" }, { status: 429 }));
    await expect(rejected.adapter.submit(request)).rejects.toThrow(/HTTP 429/);
    expect(rejected.fetchMock).toHaveBeenCalledOnce();
    const restricted = fixture("sd10-seedance-2.0-mini");
    await expect(restricted.adapter.submit(request)).rejects.toThrow(/not available/);
    expect(restricted.fetchMock).not.toHaveBeenCalled();
  });

  it("pins public reference preflight only to the supported video supplier and group", () => {
    expect(restRequestRequiresPublicAssets({}, request.model, request.operation, { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "视频" })).toBe(true);
    for (const config of [{ baseUrl: "https://vapi.chuangxiangai.asia.example", modelGroup: "视频" }, { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图" }])
      expect(restRequestRequiresPublicAssets({}, request.model, request.operation, config)).toBe(false);
  });
  it("overrides obsolete generic frame flags so valid SD11 mixed references reach the wire", async () => {
    const f = fixture("sd11-seedance-2.0");
    Object.assign(f.connector.models![0]!.metadata ??= {}, { supportsFirstLastFrames: true, allowFrameMediaMix: false, requiresImageWithAudio: true });
    // Re-resolve with the stale descriptor, as restored saved connections do.
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: request.connectionId, provider: "rest", baseUrl: "https://vapi.chuangxiangai.asia", apiKey: "fixture-key", settings: { ...f.settings, connector: f.connector } }]), { fetch: f.fetchMock });
    await adapter.submit({ ...request, model: "sd11-seedance-2.0", assets: [
      { id: "first", kind: "image", mimeType: "image/png", role: "firstFrame", url: "https://assets.example/first.png" },
      { id: "ref", kind: "video", mimeType: "video/mp4", role: "reference", url: "https://assets.example/ref.mp4" },
      { id: "audio", kind: "audio", mimeType: "audio/mpeg", role: "reference", url: "https://assets.example/audio.mp3" },
    ] });
    expect(JSON.parse(String(f.fetchMock.mock.calls[0]![1]?.body))).toMatchObject({ first_image_url: "https://assets.example/first.png", reference_videos: ["https://assets.example/ref.mp4"], reference_audios: ["https://assets.example/audio.mp3"] });
  });
});
