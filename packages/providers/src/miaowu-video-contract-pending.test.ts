import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest, ProviderOperation, ResolvedProviderConnection } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { isMiaowuUnverifiedAutoVideoContract, isMiaowuUnverifiedKeyScanVideoModel, MIAOWU_VIDEO_CONTRACT_PENDING_REASON } from "./miaowu-video-contract-pending.js";

// Keep detection of an explicitly frozen old connector, while automatic current
// contracts use Chat and editing preserves source-video URLs in prompt text.
const pendingIds = ["video-editing"];
const legacyChat: NonNullable<RestConnectorConfig["modelOverrides"]>[string] = {
  submit: { path: "/v1/chat/completions", method: "POST", bodyMode: "json",
    template: { messages: [{ role: "user", content: "" }], stream: false }, mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/messages/0/content", source: { kind: "request", path: "$.prompt" } },
    ] },
  output: { path: "$.choices[0].message.content", fallbackPaths: ["$.video_url", "$.url", "$.data[0].url"], kind: "video", defaultMimeType: "video/mp4" },
};
const response = { taskIdPath: "$.id", statusPath: "$.status", progressPath: "$.progress", errorPath: "$.error.message" };
function model(id = pendingIds[0]!, metadata: Record<string, unknown> = {}): ModelDescriptor {
  return { id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"], parameters: [],
    metadata: { canvasRunnable: true, parameterSource: "key-model-scan", parameterControlsUnavailable: true, ...metadata } };
}
function connector(selected: ModelDescriptor, legacy = true): RestConnectorConfig {
  return { auth: { type: "bearer" }, allowedHosts: ["api.miaowuai.store"], models: [selected], restrictModels: true,
    ...(legacy ? { modelOverrides: { [selected.id]: structuredClone(legacyChat) } } : {}),
    submit: { path: "/v1/videos", method: "POST", bodyMode: "json", mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      { target: "/seconds", source: { kind: "request", path: "$.parameters.duration" } },
      { target: "/ratio", source: { kind: "request", path: "$.parameters.aspect_ratio" }, omitIfUndefined: true },
      { target: "/resolution", source: { kind: "request", path: "$.parameters.resolution" }, omitIfUndefined: true },
      { target: "/image_urls", source: { kind: "assets", assetKind: "image" }, omitIfEmpty: true },
      { target: "/video_urls", source: { kind: "assets", assetKind: "video" }, omitIfEmpty: true },
      { target: "/audio_urls", source: { kind: "assets", assetKind: "audio" }, omitIfEmpty: true },
    ], response },
    poll: { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response },
    output: { path: "$.url", fallbackPaths: ["$.data.url", "$.video_url", "$.result_url"], kind: "video", defaultMimeType: "video/mp4",
      contentFallback: { path: "/v1/dream/tasks/{taskId}/content" } },
  };
}
function fixture(selected = model(), settings: Record<string, unknown> = {}, configured = connector(selected)) {
  const connection: ResolvedProviderConnection = { id: "isolated-miaowu", provider: "rest", apiKey: "synthetic-key-only", baseUrl: "https://api.miaowuai.store",
    settings: { preset: "miaowu-openai-videos", modelGroup: "default", modelScanStatus: "live", scannedModelIds: [selected.id],
      modelCatalogModels: [selected], connector: configured, ...settings } };
  const resolver = new StaticConnectionResolver([connection]);
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected mocked fetch"); });
  const adapter = createDefaultProviderRegistry(resolver, { fetch: fetcher }).get("rest");
  const rest = new GenericRestAdapter(resolver, { fetch: fetcher });
  const fixedRest = new GenericRestAdapter(resolver, { fetch: fetcher, config: configured });
  const request = (operation: ProviderOperation = "video.generate"): NormalizedRequest => ({ connectionId: connection.id, model: selected.id,
    operation, prompt: "Synthetic test", parameters: { duration: 6 }, idempotencyKey: "isolated-request" });
  const config = { ...connection.settings, baseUrl: connection.baseUrl };
  return { connection, config, adapter, rest, fixedRest, fetcher, request, configured };
}
function savedBinding(selected: ModelDescriptor, operations: readonly ProviderOperation[] = selected.operations) {
  return { [selected.id]: { model: { ...selected, operations }, sourceUrl: "https://api.miaowuai.store/documented-video",
    connector: { auth: { type: "bearer" }, allowedHosts: ["api.miaowuai.store"],
      submit: { path: "/documented-video", method: "POST", bodyMode: "json", mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ] }, output: { path: "$.url", kind: "video", defaultMimeType: "video/mp4" } } } };
}

describe("unverified Miaowu directory video contracts", () => {
  it("submits editing through current Chat with every source-video URL in prompt text", async () => {
    const f = fixture(model("video-editing", { canvasRunnable: false, canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同", autoInterfaceStatus: "incomplete" }));
    const original = structuredClone(f.connection);
    const input: NormalizedRequest = { ...f.request(), prompt: "将云层变为落日", parameters: { duration: 123, crop: "unimplemented", resolution: "unconfirmed" }, assets: [
      { id: "clip-1", kind: "video", mimeType: "video/mp4", url: "https://media.example/source-1.mp4" },
      { id: "clip-2", kind: "video", mimeType: "video/webm", url: "https://media.example/source-2.webm" },
      { id: "image", kind: "image", mimeType: "image/png", url: "https://media.example/reference.png" },
    ] };
    expect((await f.rest.validate(input)).valid).toBe(true);
    f.fetcher.mockResolvedValueOnce(Response.json({ id: "chat-edit", choices: [{ message: { content: [{ type: "video_url", video_url: { url: "https://media.example/edited.mp4" } }] } }] }));
    const task = await f.adapter.submit(input);
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/v1/chat/completions");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: "video-editing", stream: false, messages: [{ role: "user", content: [
      { type: "text", text: "将云层变为落日\n参考视频 1: https://media.example/source-1.mp4\n参考视频 2: https://media.example/source-2.webm" },
      { type: "image_url", image_url: { url: "https://media.example/reference.png", detail: "high" } },
    ] }] });
    expect(task.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(task.result)).toMatchObject([{ kind: "video", url: "https://media.example/edited.mp4" }]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.connection).toEqual(original);
  });

  it.each([
    { label: "no video", assets: [], parameters: {} },
    { label: "image only", assets: [{ id: "image", kind: "image" as const, mimeType: "image/png", url: "https://media.example/ref.png" }], parameters: {} },
    { label: "insecure video", assets: [{ id: "video", kind: "video" as const, mimeType: "video/mp4", url: "http://media.example/source.mp4" }], parameters: {} },
    { label: "private video URL", assets: [{ id: "video", kind: "video" as const, mimeType: "video/mp4", url: "https://127.0.0.1/source.mp4" }], parameters: {} },
    { label: "malformed HTTPS URL", assets: [{ id: "video", kind: "video" as const, mimeType: "video/mp4", url: "https://" }], parameters: {} },
    { label: "local video bytes", assets: [{ id: "video", kind: "video" as const, mimeType: "video/mp4", data: new Uint8Array([1, 2, 3]) }], parameters: {} },
    { label: "native field without video asset", assets: [], parameters: { video_urls: ["https://media.example/source.mp4"] } },
  ])("rejects editing with $label before transport", async entry => {
    const f = fixture(), input: NormalizedRequest = { ...f.request(), assets: entry.assets, parameters: entry.parameters };
    expect((await f.rest.validate(input)).valid).toBe(false);
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("keeps an editing response without actual video uncertain and never resubmits", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(Response.json({ id: "only-chat-id", choices: [{ message: { content: "accepted" } }] }));
    const input: NormalizedRequest = { ...f.request(), assets: [{ id: "video", kind: "video", mimeType: "video/mp4", url: "https://media.example/source.mp4" }] };
    await expect(f.adapter.submit(input)).rejects.toMatchObject({ details: { kind: "invalid_response", retryable: false, submissionMayHaveOccurred: true } });
    expect(f.fetcher).toHaveBeenCalledOnce();
  });

  it.each(["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal"])("repairs old chat mappings for the documented video directory alias %s", async id => {
    const f = fixture(model(id, { canvasRunnable: false, canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同", autoInterfaceStatus: "incomplete" })), original = structuredClone(f.connection);
    const input = { ...f.request(), parameters: { duration: 7, aspect_ratio: "16:9", resolution: "720p", unknown_field: "not-sent" },
      assets: [{ id: "ref", kind: "image" as const, mimeType: "image/png", url: "https://media.example/ref.png" }] };
    f.fetcher.mockResolvedValueOnce(Response.json({ id: "chat-directory", choices: [{ message: { content: "[视频](https://media.example/output.mp4)" } }] }));
    expect((await f.rest.validate(input)).valid).toBe(true);
    const task = await f.adapter.submit(input);
    expect(String(f.fetcher.mock.calls[0]?.[0])).toBe("https://api.miaowuai.store/v1/chat/completions");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, stream: false, messages: [{ role: "user", content: [{ type: "text", text: "Synthetic test" }, { type: "image_url", image_url: { url: "https://media.example/ref.png", detail: "high" } }] }] });
    expect(task.status).toBe("succeeded");
    expect(await f.adapter.extractOutputs(task.result)).toMatchObject([{ kind: "video", url: "https://media.example/output.mp4" }]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.connection).toEqual(original);
  });
  it.each([
    { label: "403", metadata: { canvasUnavailableReason: "403 当前 Key 没有权限" }, settings: {} },
    { label: "inventory exclusion", metadata: { canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同" }, settings: { scannedModelIds: [] } },
    { label: "unauthorized", metadata: { canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同" }, settings: { modelScanStatus: "unauthorized" } },
    { label: "unrelated gate", metadata: { canvasUnavailableReason: "供应商未通过人工业务审核" }, settings: {} },
  ])("preserves Miaowu's $label gate during exact directory restoration", async entry => {
    const f = fixture(model("seedance-2.5-deal", { canvasRunnable: false, ...entry.metadata }), entry.settings);
    expect((await f.rest.validate(f.request())).valid).toBe(false);
    await expect(f.adapter.submit(f.request())).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each(pendingIds)("blocks an explicitly frozen legacy chat connector for %s before transport", async id => {
    const selected = model(id), f = fixture(selected), original = structuredClone(f.connection);
    expect(isMiaowuUnverifiedAutoVideoContract(f.config, selected)).toBe(true);
    for (const adapter of [f.fixedRest]) {
      for (const operation of ["video.generate", "video.image-to-video"] as const) {
        const validation = await adapter.validate(f.request(operation));
        expect(validation.valid).toBe(false);
        expect(validation.issues).toContainEqual(expect.objectContaining({ code: "interface_unavailable", message: expect.stringContaining(MIAOWU_VIDEO_CONTRACT_PENDING_REASON) }));
        await expect(adapter.submit(f.request(operation))).rejects.toThrow(MIAOWU_VIDEO_CONTRACT_PENDING_REASON);
      }
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.connection).toEqual(original);
  });

  it("keeps the pending replacement from falling back to the generic video endpoint", async () => {
    for (const id of pendingIds) {
      const selected = model(id, { miaowuVideoContractPending: true }), f = fixture(selected, {}, connector(selected, false));
      expect(isMiaowuUnverifiedAutoVideoContract(f.config, selected)).toBe(true);
      await expect(f.fixedRest.submit(f.request())).rejects.toThrow(MIAOWU_VIDEO_CONTRACT_PENDING_REASON);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  });

  it("preserves explicit endpoint, mapping, output and operation override changes", async () => {
    const selected = model();
    const base = connector(selected);
    const custom = { ...legacyChat, submit: { ...legacyChat.submit!, path: "/custom-video", template: { model: selected.id, prompt: "custom" }, mappings: [] } };
    const variants: RestConnectorConfig[] = [
      { ...base, modelOverrides: { [selected.id]: custom } },
      { ...base, modelOverrides: { [selected.id]: { ...legacyChat, submit: { ...legacyChat.submit!, mappings: [] } } } },
      { ...base, modelOverrides: { [selected.id]: { ...legacyChat, output: { ...legacyChat.output!, path: "$.custom_video" } } } },
      { ...base, operationOverrides: { "video.generate": { submit: custom.submit! } } },
    ];
    for (const configured of variants) expect(isMiaowuUnverifiedAutoVideoContract(fixture(selected, {}, configured).config, selected)).toBe(false);
    for (const operationOverrides of [{}, { "image.generate": { submit: custom.submit! } }, { "video.generate": {} }]) {
      const unchanged = fixture(selected, {}, { ...base, operationOverrides });
      expect(isMiaowuUnverifiedAutoVideoContract(unchanged.config, selected)).toBe(true);
      await expect(unchanged.fixedRest.submit(unchanged.request())).rejects.toThrow(MIAOWU_VIDEO_CONTRACT_PENDING_REASON);
      expect(unchanged.fetcher).not.toHaveBeenCalled();
    }
    const partial = fixture(selected, {}, variants[3]!);
    expect(isMiaowuUnverifiedAutoVideoContract(partial.config, selected, undefined, "video.image-to-video")).toBe(true);
    await expect(partial.fixedRest.submit(partial.request("video.image-to-video"))).rejects.toThrow(MIAOWU_VIDEO_CONTRACT_PENDING_REASON);
    expect(partial.fetcher).not.toHaveBeenCalled();
    const f = fixture(selected, {}, variants[0]!);
    expect((await f.adapter.validate(f.request())).valid).toBe(true);
    f.fetcher.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "https://media.example/custom.mp4" } }] }));
    const task = await f.adapter.submit(f.request());
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/custom-video");
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "video", url: "https://media.example/custom.mp4", mimeType: "video/mp4" }]);
  });

  it("preserves published video_api, manual, measured and unrelated model contracts", async () => {
    for (const selected of [model(undefined, { parameterSource: "pricing.video_api" }), model(undefined, { source: "manual" }),
      model(undefined, { protocolEvidence: "paid-test" }), model("seedance-2.0-deal"), model("future-unknown-video")]) {
      const f = fixture(selected);
      expect(isMiaowuUnverifiedKeyScanVideoModel(selected)).toBe(false);
      expect((await f.adapter.validate(f.request())).valid).toBe(true);
    }
    const published = model("seedance-2.0-deal", { parameterSource: "pricing.video_api" });
    const f = fixture(published);
    f.fetcher.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "https://media.example/published.mp4" } }] }));
    await f.adapter.submit(f.request());
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/v1/chat/completions");
  });

  it("preserves a custom base contract when no model override is present", async () => {
    const selected = model("seedance-2.5-deal"), base = connector(selected, false);
    const configured: RestConnectorConfig = { ...base, modelOverrides: {},
      submit: { path: "/my-verified-video", method: "POST", bodyMode: "json", mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ] }, output: { path: "$.video_url", kind: "video", defaultMimeType: "video/mp4" } };
    const f = fixture(selected, {}, configured);
    f.fetcher.mockResolvedValueOnce(Response.json({ video_url: "https://media.example/custom-base.mp4" }));
    expect((await f.rest.validate(f.request())).valid).toBe(true);
    const task = await f.adapter.submit(f.request());
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/my-verified-video");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: selected.id, prompt: "Synthetic test" });
    expect(await f.adapter.extractOutputs(task.result)).toMatchObject([{ kind: "video", url: "https://media.example/custom-base.mp4" }]);
  });

  it("does not widen a saved generate-only binding or repair an incomplete explicit binding", async () => {
    const selected = { ...model("seedance-2.5-deal"), operations: ["video.generate"] as const };
    const f = fixture(selected, { autoModelInterfaces: savedBinding(selected) });
    const unsupported = f.request("video.image-to-video");
    expect((await f.rest.validate(unsupported)).valid).toBe(false);
    await expect(f.adapter.submit(unsupported)).rejects.toThrow();
    const pending = { ...selected, metadata: { ...selected.metadata, autoInterfaceStatus: "incomplete", canvasRunnable: false,
      canvasUnavailableReason: "当前分组列出此型号，但尚未提供其参数与调用合同" } };
    const blocked = fixture(pending, { autoModelInterfaces: savedBinding(pending) });
    expect((await blocked.rest.validate(blocked.request())).valid).toBe(false);
    await expect(blocked.adapter.submit(blocked.request())).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(blocked.fetcher).not.toHaveBeenCalled();
  });

  it("preserves other suppliers, account groups and same-ID non-video declarations", () => {
    const selected = model(), f = fixture(selected);
    for (const extra of [
      { preset: "custom" }, { modelGroup: "video" }, { accountKeyGroup: "video" },
      { baseUrl: "https://other.example" }, { baseUrl: "http://api.miaowuai.store" },
      { baseUrl: "https://api.miaowuai.store/custom" }, { baseUrl: "https://user:password@api.miaowuai.store" },
      { baseUrl: "https://api.miaowuai.store?custom=1" }, { baseUrl: "https://api.miaowuai.store#custom" },
    ]) expect(isMiaowuUnverifiedAutoVideoContract({ ...f.config, ...extra }, selected)).toBe(false);
    for (const changed of [
      { ...selected, operations: ["image.generate"] as const, outputKinds: ["image"] as const },
      { ...selected, operations: ["image.generate", "video.generate"] as const, outputKinds: ["image", "video"] as const },
      { ...selected, outputKinds: ["text"] as const },
    ]) expect(isMiaowuUnverifiedKeyScanVideoModel(changed)).toBe(false);
  });

  it("uses a complete exact binding and rejects incomplete bindings", async () => {
    const selected = model(), f = fixture(selected, { autoModelInterfaces: savedBinding(selected) });
    expect(isMiaowuUnverifiedAutoVideoContract(f.config, selected)).toBe(false);
    f.fetcher.mockResolvedValueOnce(Response.json({ url: "https://media.example/bound.mp4" }));
    expect((await f.adapter.validate(f.request())).valid).toBe(true);
    const task = await f.adapter.submit(f.request());
    expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/documented-video");
    expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "video", url: "https://media.example/bound.mp4", mimeType: "video/mp4" }]);
    const incomplete = model(undefined, { autoInterfaceStatus: "incomplete", canvasUnavailableReason: MIAOWU_VIDEO_CONTRACT_PENDING_REASON });
    const blocked = fixture(incomplete, { autoModelInterfaces: savedBinding(incomplete) });
    expect(isMiaowuUnverifiedAutoVideoContract(blocked.config, incomplete)).toBe(true);
    await expect(blocked.fixedRest.submit(blocked.request())).rejects.toThrow(MIAOWU_VIDEO_CONTRACT_PENDING_REASON);
    expect(blocked.fetcher).not.toHaveBeenCalled();
  });

  it("does not let a partial binding grant its unsupported operation", async () => {
    for (const operation of ["video.generate", "video.image-to-video"] as const) {
      const other = operation === "video.generate" ? "video.image-to-video" : "video.generate";
      const selected = model(), f = fixture(selected, { autoModelInterfaces: savedBinding(selected, [operation]) });
      expect(isMiaowuUnverifiedAutoVideoContract(f.config, selected)).toBe(true);
      expect(isMiaowuUnverifiedAutoVideoContract(f.config, selected, undefined, operation)).toBe(false);
      expect(isMiaowuUnverifiedAutoVideoContract(f.config, selected, undefined, other)).toBe(true);
      expect((await f.adapter.validate(f.request(operation))).valid).toBe(true);
      await expect(f.fixedRest.submit(f.request(other))).rejects.toThrow(MIAOWU_VIDEO_CONTRACT_PENDING_REASON);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  });
});
