import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { cangyuanMusicModel, cangyuanMusicRequestIssues, withCangyuanMusicRequestParameters } from "./cangyuan-music.js";
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
  it("keeps explicit music values and the original lyric draft while filling only absent defaults", () => {
    const input = request({ instrumental: true, lyrics: "保存这段歌词", audio_format: "wav", duration: 90, bpm: 144, seed: 23 });
    expect(withCangyuanMusicRequestParameters(input).parameters).toEqual({ instrumental: true, audio_format: "wav", duration: 90, bpm: 144, seed: 23, n: 1 });
    expect(input.parameters?.lyrics).toBe("保存这段歌词");
    expect(withCangyuanMusicRequestParameters(request({ instrumental: false, lyrics: "[Verse]晨光", audio_format: "m4a" })).parameters).toEqual({ instrumental: false, lyrics: "[Verse]晨光", audio_format: "m4a", n: 1 });
  });
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

describe("沧元官方 Suno 独立音乐合同", () => {
  const suno = cangyuanMusicModel({ id: "suno", name: "Suno", operations: [] });
  const sunoRequest = (parameters: Record<string, unknown> = {}): NormalizedRequest => ({ ...request(parameters), model: "suno" });
  function sunoFixture(payloads: unknown[], settings: Record<string, unknown> = {}) {
    const fetcher = vi.fn<typeof fetch>();
    for (const payload of payloads) fetcher.mockResolvedValueOnce(Response.json(payload));
    const resolver = new StaticConnectionResolver([{ id: "music-test", provider: "rest", apiKey: "isolated-suno-test-key",
      baseUrl: "https://ai.cangyuansuanli.cn/v1", settings: { connector: { ...config, models: [suno] },
        scannedModelIds: [suno.id], modelCatalogModels: [suno], ...settings } }]);
    return { fetcher, resolver, adapter: new GenericRestAdapter(resolver, { fetch: fetcher }) };
  }
  it("declares one request with two audio results without borrowing Lyria controls or defaults", () => {
    expect(suno).toMatchObject({ operations: ["music.generate"], outputKinds: ["audio"],
      limits: { maxPromptCharacters: 2000, maxInputImages: 0, maxInputVideos: 0, maxInputAudios: 0 },
      metadata: { fixedOutputCount: 2, canvasRunnable: true, durationIsCreativeHint: false } });
    expect(suno.parameters?.map(p => p.key)).toEqual(["n"]);
    expect(suno.parameters?.[0]).toMatchObject({ default: 1, options: [{ value: 1 }] });
    expect(withCangyuanMusicRequestParameters(sunoRequest()).parameters).toEqual({ n: 1 });
  });
  it("submits only documented fields, persists the task and returns both public results without a content call", async () => {
    const f = sunoFixture([{ task_id: "suno_42", status: "queued" }, { id: "suno_42", status: "in_progress" },
      { id: "suno_42", status: "completed", music_url: ["https://cdn.example.test/suno-a", "https://cdn.example.test/suno-b"] }]);
    const task = await f.adapter.submit(sunoRequest());
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe("https://ai.cangyuansuanli.cn/v1/music");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer isolated-suno-test-key");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("music-test-task");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "suno", prompt: request().prompt, n: 1 });
    const recovered = JSON.parse(JSON.stringify(task));
    const running = await f.adapter.poll(recovered);
    expect(running.status).toBe("running");
    const completed = await f.adapter.poll({ ...recovered, ...running });
    expect(completed.status).toBe("succeeded");
    expect(f.fetcher.mock.calls.slice(1).map(([u]) => u)).toEqual([
      "https://ai.cangyuansuanli.cn/v1/music/suno_42", "https://ai.cangyuansuanli.cn/v1/music/suno_42" ]);
    expect(await f.adapter.extractOutputs(completed.result)).toEqual([
      { kind: "audio", url: "https://cdn.example.test/suno-a" }, { kind: "audio", url: "https://cdn.example.test/suno-b" } ]);
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([{ lyrics: "独立歌词" }, { instrumental: true }, { duration: 30 }, { seed: 1 }, { title: "标题" },
    { bpm: 120 }, { audio_format: "mp3" }, { n: 2 }])("rejects undocumented Suno fields before any request: %j", async parameters => {
    const f = sunoFixture([]);
    await expect(f.adapter.submit(sunoRequest(parameters))).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("accepts the exact prompt boundary and rejects blank, oversized and reference input before submit", async () => {
    const f = sunoFixture([{ id: "suno_prompt", status: "queued" }]);
    await f.adapter.submit({ ...sunoRequest(), prompt: "音".repeat(2000) });
    expect(f.fetcher).toHaveBeenCalledOnce();
    f.fetcher.mockClear();
    for (const input of [ { ...sunoRequest(), prompt: "音".repeat(2001) }, { ...sunoRequest(), prompt: " \n " },
      { ...sunoRequest(), assets: [{ id: "audio", kind: "audio" as const, mimeType: "audio/mpeg", url: "https://cdn.example.test/ref" }] } ])
      await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("preserves terminal failure, missing-ID uncertainty and missing Key inventory", async () => {
    const f = sunoFixture([{ id: "suno_fail", status: "queued" }, { id: "suno_fail", status: "failed", error: { message: "fixture failure" } }]);
    expect(await f.adapter.poll(await f.adapter.submit(sunoRequest()))).toMatchObject({ status: "failed", error: "fixture failure" });
    const missing = sunoFixture([{ status: "queued" }]);
    await expect(missing.adapter.submit(sunoRequest())).rejects.toMatchObject({ details: {
      kind: "invalid_response", retryable: false, submissionMayHaveOccurred: true } });
    expect(missing.fetcher).toHaveBeenCalledOnce();
    const denied = sunoFixture([], { scannedModelIds: [] });
    const wrapped = new AutoInterfaceAdapter(denied.resolver, denied.adapter, { fetch: denied.fetcher });
    expect(await wrapped.validate(sunoRequest())).toMatchObject({ valid: false });
    expect(denied.fetcher).not.toHaveBeenCalled();
    expect(cangyuanMusicModel({ ...suno, metadata: { canvasRunnable: false, canvasUnavailableReason: "401 Key 未返回此型号" } }).metadata?.canvasRunnable).toBe(false);
  });
  it("uses a fresh same-Key Suno descriptor before the old connector model array is persisted without granting missing or denied inventory", async () => {
    const oldConnector = { ...config, models: [descriptor] };
    const f = sunoFixture([{ id: "suno_fresh", status: "queued" }], { connector: oldConnector, modelScanStatus: "live" });
    expect(await f.adapter.validate(sunoRequest())).toMatchObject({ valid: true });
    await f.adapter.submit(sunoRequest());
    expect(f.fetcher.mock.calls[0]![0]).toBe("https://ai.cangyuansuanli.cn/v1/music");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toEqual({ model: "suno", prompt: request().prompt, n: 1 });
    expect(oldConnector.models).toEqual([descriptor]);
    for (const settings of [{ scannedModelIds: [] }, { modelScanStatus: "unauthorized" },
      { modelCatalogModels: [{ ...suno, metadata: { canvasRunnable: false, canvasUnavailableReason: "401" } }] },
      { usage: "disabled" }, { supplierArchived: true }]) {
      const denied = sunoFixture([], { connector: oldConnector, ...settings });
      await expect(denied.adapter.submit(sunoRequest())).rejects.toThrow();
      expect(denied.fetcher).not.toHaveBeenCalled();
    }
  });
});
