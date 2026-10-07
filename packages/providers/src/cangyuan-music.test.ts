import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { cangyuanMusicModel, cangyuanMusicRequestIssues } from "./cangyuan-music.js";
import { scanProviderModelCatalog } from "./model-catalog.js";
import type { NormalizedRequest } from "./contracts.js";

const descriptor = cangyuanMusicModel({ id: "lyria-3-pro", name: "Lyria Pro", operations: [] });
const config: RestConnectorConfig = { submit: { path: "/v1/images/generations", method: "POST" }, output: { path: "$.data", kind: "image" }, auth: { type: "bearer" }, restrictModels: true, models: [descriptor] };
const request = (parameters: Record<string, unknown> = {}): NormalizedRequest => ({ connectionId: "music-test", operation: "music.generate", model: "lyria-3-pro", prompt: "轻快的钢琴与弦乐", idempotencyKey: "music-test-task", parameters });
function fixture(payloads: unknown[], extra: Record<string, unknown> = {}) {
  const fetcher = vi.fn<typeof fetch>();
  for (const payload of payloads) fetcher.mockResolvedValueOnce(Response.json(payload));
  const resolver = new StaticConnectionResolver([{ id: "music-test", provider: "rest", apiKey: "isolated-music-test-key", baseUrl: "https://ai.cangyuansuanli.cn", settings: { connector: config, scannedModelIds: [descriptor.id], modelCatalogModels: [descriptor], ...extra } }]);
  return { fetcher, resolver, adapter: new GenericRestAdapter(resolver, { fetch: fetcher }) };
}
describe("沧元官方 Lyria 音乐合同", () => {
  it.each(["403 权限拒绝", "401 unauthorized", "当前 Key 未返回此模型", "模型下架", "账号未开通"])("preserves explicit inventory denial: %s", reason => {
    const blocked = cangyuanMusicModel({ ...descriptor, metadata: { canvasRunnable: false, canvasUnavailableReason: reason, autoInterfaceStatus: "incomplete" } });
    expect(blocked.metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason: reason });
  });
  it("repairs only an unsupported native protocol and uses the official vocal default", () => {
    const repaired = cangyuanMusicModel({ ...descriptor, metadata: { canvasRunnable: false, canvasUnavailableReason: "音乐协议尚未内置", autoInterfaceStatus: "incomplete" } });
    expect(repaired.metadata?.canvasRunnable).toBe(true);
    expect(repaired.metadata?.canvasUnavailableReason).toBeUndefined();
    expect(repaired.parameters?.find(parameter => parameter.key === "instrumental")?.default).toBe(false);
  });
  it.each([["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["m4a", "audio/mp4"]])("submits and resumes %s tasks, preserving idempotency and output format", async (audio_format, mimeType) => {
    const { adapter, fetcher } = fixture([{ id: "audio_42", status: "queued", progress: 0 }, { id: "audio_42", status: "completed", music_url: ["https://cdn.example.test/one", "https://cdn.example.test/two"] }]);
    const task = await adapter.submit(request({ instrumental: false, title: "晨光", lyrics: "[Verse]\n晨光照进窗", duration: 60, bpm: 72, seed: 0, audio_format }));
    expect(task.status).toBe("queued");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://ai.cangyuansuanli.cn/v1/music");
    const init = fetcher.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("music-test-task");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "lyria-3-pro", prompt: "轻快的钢琴与弦乐", instrumental: false, title: "晨光", lyrics: "[Verse]\n晨光照进窗", duration: 60, bpm: 72, seed: 0, audio_format, n: 1 });
    const recovered = JSON.parse(JSON.stringify(task));
    const state = await adapter.poll(recovered);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://ai.cangyuansuanli.cn/v1/music/audio_42");
    expect(state.status).toBe("succeeded");
    expect(await adapter.extractOutputs(state.result)).toEqual([
      { kind: "audio", url: "https://cdn.example.test/one", mimeType }, { kind: "audio", url: "https://cdn.example.test/two", mimeType },
    ]);
    // Public CDN outputs are archived separately without another authenticated provider request.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("omits lyrics for instrumental work and keeps upstream failure terminal", async () => {
    const { adapter, fetcher } = fixture([{ id: "audio_43", status: "queued" }, { id: "audio_43", status: "failed", error: { message: "upstream music failure" } }]);
    const task = await adapter.submit(request({ instrumental: true, lyrics: "do not send these" }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ instrumental: true, audio_format: "mp3", n: 1 });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty("lyrics");
    const state = await adapter.poll(task);
    expect(state).toMatchObject({ status: "failed", error: "upstream music failure" });
  });
  it.each([{ status: "queued" }, { id: "", status: "processing" }, { id: "   ", status: "queued" }, { status: "completed", music_url: "https://cdn.example.test/one" }])("keeps accepted music responses with missing task IDs uncertain: %j", async payload => {
    const { adapter, fetcher } = fixture([payload]);
    await expect(adapter.submit(request())).rejects.toMatchObject({ details: { kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true, responseBody: payload } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([{ duration: 0 }, { duration: 301 }, { duration: 5.5 }, { bpm: 29 }, { seed: -1 }, { n: 2 }, { audio_format: "flac" }, { size: "1024x1024" }, { instrumental: "true" }])("rejects undocumented or out-of-range music input before submit: %j", async parameters => {
    const { adapter, fetcher } = fixture([]);
    await expect(adapter.submit(request(parameters))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps native music capability separate from image/video and rejects missing Key inventory", async () => {
    const models = scanProviderModelCatalog({ data: [{ id: "lyria-3-pro" }, { id: "lyria-3.5" }] }).models;
    expect(models.map(model => [model.operations, model.outputKinds])).toEqual([[ ["music.generate"], ["audio"] ], [ ["music.generate"], ["audio"] ]]);
    expect(cangyuanMusicRequestIssues({ ...request(), assets: [{ id: "ref", kind: "audio", mimeType: "audio/mpeg", url: "https://cdn.example.test/ref.mp3" }] })).not.toEqual([]);
    const { resolver, adapter, fetcher } = fixture([], { scannedModelIds: [] });
    const wrapped = new AutoInterfaceAdapter(resolver, adapter, { fetch: fetcher });
    expect(await wrapped.validate(request())).toMatchObject({ valid: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
