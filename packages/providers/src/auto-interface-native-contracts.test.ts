import { describe, expect, it, vi } from "vitest";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { StaticConnectionResolver } from "./credentials.js";
import { cangyuanVideoModel } from "./cangyuan-video-contract.js";
import { chuangxiangVideoModel } from "./chuangxiang-video-contract.js";
import type { ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderAssetInput, ProviderTask, ResolvedProviderConnection } from "./contracts.js";

const nativeCangyuan = ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-5-260628", "doubao-seedance-2-0-mini-260615"];
const nativeChuangxiang = ["grok-imagine-video", "grok-imagine-video-1.5", "gv3-grok-video-1.5", "happyhorse-1.1", "kl1-kling-3.0", "kling-3.0", "kling-3.0-pro",
  "mm2-minimax-h3", "mm2-minimax-h3-max", "mm3-minimax-h3-2k", "sd10-seedance-2.0", "sd10-seedance-2.0-fast", "sd10-seedance-2.0-mini", "sd10-seedance-2.5",
  "sd11-seedance-2.0", "sd11-seedance-2.0-fast", "sd11-seedance-2.0-mini", "sd11-seedance-2.5", "sd13-seedance-2.0", "sd13-seedance-2.0-fast", "sd13-seedance-2.0-mini",
  "sd13-seedance-2.5", "sd14-seedance-2.0", "sd15-seedance-2.0", "sd15-seedance-2.5", "sd7-seedance-2.0-1080p", "sd7-seedance-2.0-720p", "sd8-seedance-2.5", "wan4-wan3.0",
  "niulai-pro", "omni-fast", "omni-fast-no-water", "omni-v2v", "omni-v2v-no-water"];
const image: ProviderAssetInput = { id: "reference", kind: "image", mimeType: "image/png", url: "https://media.example/reference.png" };
const video: ProviderAssetInput = { id: "video", kind: "video", mimeType: "video/mp4", url: "https://media.example/reference.mp4", durationSeconds: 4 };

function fixture(supplier: "cangyuan" | "chuangxiang", id: string, extra: Record<string, unknown> = {}, selected?: ModelDescriptor) {
  const baseUrl = supplier === "cangyuan" ? "https://ai.cangyuansuanli.cn/v1" : "https://vapi.chuangxiangai.asia/v1";
  const raw: ModelDescriptor = selected ?? { id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"], metadata: { canvasRunnable: true } };
  const model = supplier === "cangyuan" ? cangyuanVideoModel(raw) : chuangxiangVideoModel(id, raw);
  const connection: ResolvedProviderConnection = { id: "native-isolated", provider: "openai", apiKey: "synthetic-native-group-key", baseUrl,
    settings: { modelGroup: supplier === "cangyuan" ? "VIDEO-Seedance官转" : "视频", modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [selected ?? raw], ...extra } };
  const fallback = { testConnection: vi.fn(async () => undefined), listModels: vi.fn(async () => []), validate: vi.fn(async () => ({ valid: true, issues: [] })),
    submit: vi.fn(async (): Promise<ProviderTask> => { throw new Error("Unexpected Images fallback"); }),
    poll: vi.fn(async (): Promise<ProviderTask> => { throw new Error("Unexpected Images poll"); }), extractOutputs: vi.fn(async () => []) } satisfies ProviderAdapter;
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected mocked network call"); });
  const resolver = new StaticConnectionResolver([connection]);
  const adapter = new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher });
  const input = (parameters: Record<string, unknown> = {}, assets: readonly ProviderAssetInput[] = []): NormalizedRequest => ({
    connectionId: connection.id, model: id, operation: "video.generate", prompt: "Ocean sunrise", parameters, assets,
  });
  const duration = model.parameters?.find(p => p.key === "duration")?.default ?? 6;
  return { adapter, fallback, fetcher, connection, resolver, input, duration };
}

describe("documented native Cangyuan and Chuangxiang video contracts", () => {
  it.each([
    ...nativeCangyuan.map(id => ({ supplier: "cangyuan" as const, id, path: "/v1/videos" })),
    ...nativeChuangxiang.map(id => ({ supplier: "chuangxiang" as const, id, path: "/v1/videos/generations" })),
  ])("validates, submits and polls $supplier $id with its original native connection", async ({ supplier, id, path }) => {
    const f = fixture(supplier, id);
    const original = structuredClone(f.connection);
    const parameters = supplier === "cangyuan" ? { seconds: f.duration, audio: false, resolution: "720p", aspect_ratio: "9:16", face_mode: true, seed: 7 }
      : { duration: f.duration, aspect_ratio: "9:16" };
    const input = f.input(parameters, id.startsWith("omni-v2v") ? [video] : [{ ...image, ...(id === "kl1-kling-3.0" ? { role: "firstFrame" as const } : {}) }]);
    expect((await f.adapter.validate(input)).valid).toBe(true);
    expect(f.fetcher).not.toHaveBeenCalled();
    f.fetcher.mockResolvedValueOnce(Response.json({ request_id: "native_task", id: "native_task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ status: "completed", video_url: "https://media.example/result.mp4" }));
    const task = await f.adapter.submit(input);
    expect(task).toMatchObject({ providerTaskId: "native_task", status: "queued", result: { autoInterface: true } });
    const [url, init] = f.fetcher.mock.calls[0]!;
    expect(url).toBe(new URL(path, f.connection.baseUrl).toString());
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-native-group-key");
    expect(JSON.parse(String(init?.body))).toEqual(supplier === "cangyuan"
      ? { model: id, prompt: input.prompt, duration: f.duration, generate_audio: false, resolution: "720p", aspect_ratio: "9:16", face_mode: true, seed: 7, reference_image_urls: [image.url] }
      : { model: id, prompt: input.prompt, duration: f.duration, aspect_ratio: "9:16", n: 1,
        ...(id.startsWith("omni-v2v") ? { reference_videos: [video.url] }
          : id === "kl1-kling-3.0" ? { first_image_url: image.url } : { reference_image_urls: [image.url] }) });
    const state = await f.adapter.poll(task);
    expect(state.status).toBe("succeeded");
    expect(f.fetcher.mock.calls[1]?.[0]).toBe(new URL(`${path}/native_task`, f.connection.baseUrl).toString());
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", url: "https://media.example/result.mp4", mimeType: "video/mp4" }]);
    expect(f.connection).toEqual(original);
    expect(f.fallback.validate).not.toHaveBeenCalled();
    expect(f.fallback.submit).not.toHaveBeenCalled();
    expect(f.fallback.poll).not.toHaveBeenCalled();
    expect(f.fallback.extractOutputs).not.toHaveBeenCalled();
  });

  it("retains per-supplier parameter and asset validation before any submit", async () => {
    const cangyuan = fixture("cangyuan", nativeCangyuan[0]!);
    const chuangxiang = fixture("chuangxiang", "sd8-seedance-2.5");
    const cases = [
      { f: cangyuan, input: cangyuan.input({ duration: 16 }) },
      { f: cangyuan, input: cangyuan.input({ duration: "4" }) },
      { f: cangyuan, input: cangyuan.input({ first_image_url: image.url }) },
      { f: cangyuan, input: cangyuan.input({ first_image_url: image.url, last_image_url: image.url }, [video]) },
      { f: cangyuan, input: cangyuan.input({ face_mode: true, reference_image_urls: ["asset://ready_image"] }) },
      { f: chuangxiang, input: chuangxiang.input({ duration: 10 }) },
      { f: chuangxiang, input: chuangxiang.input({ duration: 30, resolution: "720p" }) },
      { f: chuangxiang, input: chuangxiang.input({ duration: 30 }, [video]) },
      { f: chuangxiang, input: chuangxiang.input({ duration: 30, n: 2 }) },
    ];
    for (const { f, input } of cases) {
      expect((await f.adapter.validate(input)).valid).toBe(false);
      await expect(f.adapter.submit(input)).rejects.toThrow();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.fallback.submit).not.toHaveBeenCalled();
    }
    expect((await cangyuan.adapter.validate(cangyuan.input({ reference_image_urls: ["asset://ready_image"] }))).valid).toBe(true);
    expect((await fixture("cangyuan", nativeCangyuan[2]!).adapter.validate({ ...cangyuan.input({ duration: 30 }), model: nativeCangyuan[2] })).valid).toBe(true);
  });

  it("blocks unavailable account IDs, Key denials and declared non-video output", async () => {
    for (const supplier of ["cangyuan", "chuangxiang"] as const) {
      const id = supplier === "cangyuan" ? nativeCangyuan[0]! : "sd8-seedance-2.5";
      for (const extra of [{ scannedModelIds: [] }, { modelScanStatus: "unauthorized" }, { supplierArchived: true },
        { modelCatalogModels: [{ id, name: id, operations: ["video.generate"], metadata: { canvasRunnable: false, canvasUnavailableReason: "403 当前 Key 未开通" } }] },
        { modelCatalogModels: [{ id, name: id, operations: [], outputKinds: ["text"], metadata: { catalogCapability: "chat", operationsSource: "declared", outputKindsSource: "declared" } }] }]) {
        const f = fixture(supplier, id, extra);
        expect((await f.adapter.validate(f.input({ duration: 30 }))).valid).toBe(false);
        await expect(f.adapter.submit(f.input({ duration: 30 }))).rejects.toThrow();
        expect(f.fetcher).not.toHaveBeenCalled();
        expect(f.fallback.submit).not.toHaveBeenCalled();
      }
    }
  });

  it("does not borrow a native video contract for other hosts, groups or IDs", async () => {
    for (const entry of [
      { supplier: "cangyuan" as const, id: "doubao-seedance-future", baseUrl: "https://ai.cangyuansuanli.cn" },
      { supplier: "cangyuan" as const, id: nativeCangyuan[0]!, baseUrl: "https://unrelated.example" },
      { supplier: "chuangxiang" as const, id: "seedance-future", baseUrl: "https://vapi.chuangxiangai.asia" },
      { supplier: "chuangxiang" as const, id: "sd8-seedance-2.5", baseUrl: "https://unrelated.example" },
      { supplier: "chuangxiang" as const, id: "sd8-seedance-2.5", baseUrl: "https://vapi.chuangxiangai.asia", group: "图片" },
    ]) {
      const f = fixture(entry.supplier, entry.id, entry.group ? { modelGroup: entry.group } : {});
      const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ ...f.connection, baseUrl: entry.baseUrl }]), f.fallback, { fetch: f.fetcher });
      expect((await adapter.validate(f.input({ duration: 30 }))).valid).toBe(false);
      await expect(adapter.submit(f.input({ duration: 30 }))).rejects.toThrow(/接口说明待补充/u);
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.fallback.submit).not.toHaveBeenCalled();
    }
  });

  it.each(["cangyuan", "chuangxiang"] as const)("recovers %s native tasks using the frozen transport without resubmission", async supplier => {
    const id = supplier === "cangyuan" ? nativeCangyuan[0]! : "sd8-seedance-2.5";
    const f = fixture(supplier, id);
    f.fetcher.mockResolvedValueOnce(Response.json({ request_id: "recover_task", id: "recover_task", status: "queued" }));
    const task = JSON.parse(JSON.stringify(await f.adapter.submit(f.input({ duration: f.duration })))) as ProviderTask;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ status: "completed", video_url: "https://media.example/recovered.mp4" }));
    const changed = new StaticConnectionResolver([{ ...f.connection, settings: { modelGroup: "图片", modelScanStatus: "unauthorized", scannedModelIds: [],
      connector: { submit: { path: "/wrong-images" }, poll: { path: "/wrong-poll/{taskId}" }, output: { kind: "image", path: "$.images" } } } }]);
    const adapter = new AutoInterfaceAdapter(changed, f.fallback, { fetch: fetcher });
    const state = await adapter.poll(task);
    expect(state.status).toBe("succeeded");
    expect(fetcher.mock.calls[0]?.[0]).toBe(new URL(`${supplier === "cangyuan" ? "/v1/videos" : "/v1/videos/generations"}/recover_task`, f.connection.baseUrl).toString());
    expect(await adapter.extractOutputs(state.result)).toEqual([{ kind: "video", url: "https://media.example/recovered.mp4", mimeType: "video/mp4" }]);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(f.fallback.poll).not.toHaveBeenCalled();
  });

  it("downloads Chuangxiang content through the documented authenticated content endpoint", async () => {
    const f = fixture("chuangxiang", "sd8-seedance-2.5");
    f.fetcher.mockResolvedValueOnce(Response.json({ request_id: "content_task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ status: "completed" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    const state = await f.adapter.poll(await f.adapter.submit(f.input({ duration: 30 })));
    expect(await f.adapter.extractOutputs(state.result)).toEqual([{ kind: "video", data: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }]);
    expect(f.fetcher.mock.calls[2]?.[0]).toBe("https://vapi.chuangxiangai.asia/v1/videos/content_task/content");
    expect(new Headers(f.fetcher.mock.calls[2]?.[1]?.headers).get("authorization")).toBe("Bearer synthetic-native-group-key");
  });
});
