import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { cangyuanVideoModel } from "./cangyuan-video-contract.js";
import { chuangxiangVideoModel } from "./chuangxiang-video-contract.js";
import { remainingVideoModel } from "./remaining-video-contracts.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";

const request = (model: string, parameters: Record<string, unknown> = {}, assets: ProviderAssetInput[] = []): NormalizedRequest => ({
  connectionId: "isolated-contract", model, parameters, assets, operation: "video.generate", prompt: "Ocean sunrise", idempotencyKey: "isolated-request",
});
function fixture(baseUrl: string, model: ModelDescriptor, responses: Response[] = [], extra: Record<string, unknown> = {}) {
  const fetcher = vi.fn<typeof fetch>();
  responses.forEach(response => fetcher.mockResolvedValueOnce(response));
  const connector: RestConnectorConfig = { restrictModels: true, models: [model], auth: { type: "bearer" },
    submit: { path: "/old-images", method: "POST", bodyMode: "json", template: { stale_image_field: true } }, output: { path: "$.data", kind: "image" } };
  const resolver = new StaticConnectionResolver([{ id: "isolated-contract", provider: "rest", apiKey: "mock-key", baseUrl,
    settings: { connector, ...(baseUrl.includes("chuangxiangai.asia") ? { accountKeyGroup: "视频" } : {}), ...extra } }]);
  return { fetcher, adapter: new GenericRestAdapter(resolver, { fetch: fetcher }) };
}
const cangyuanModel = (id: string) => cangyuanVideoModel({ id, name: id, operations: ["video.generate"] });
const videoAsset: ProviderAssetInput = { id: "reference-video", kind: "video", mimeType: "video/mp4", url: "https://media.example/reference.mp4", durationSeconds: 9.2 };

describe("current media contracts repair saved REST transports", () => {
  it("sends the documented Cangyuan audio field instead of stale saved image/alias mappings", async () => {
    const id = "sd11-seedance-2.0";
    const { adapter, fetcher } = fixture("https://ai.cangyuansuanli.cn/v1", cangyuanModel(id), [Response.json({ id: "video_1", status: "queued" })]);
    await adapter.submit(request(id, { seconds: 8, audio: false }));
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://ai.cangyuansuanli.cn/v1/videos");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "Ocean sunrise", duration: 8, generate_audio: false });
  });
  it("preserves measured MM3 reference objects and rejects unknown durations before any submit", async () => {
    const id = "mm3-minimax-h3-2k";
    const { adapter, fetcher } = fixture("https://ai.cangyuansuanli.cn", cangyuanModel(id), [Response.json({ id: "video_2", status: "queued" })]);
    await adapter.submit(request(id, { duration: 15 }, [videoAsset]));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ reference_videos: [{ url: videoAsset.url, duration: 9.2 }] });
    const { durationSeconds: _duration, ...unknownDuration } = videoAsset;
    await expect(adapter.submit(request(id, { duration: 15 }, [unknownDuration]))).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("uses Chuangxiang duration and the task's separate authenticated content path", async () => {
    const id = "sd10-seedance-2.0";
    const { adapter, fetcher } = fixture("https://vapi.chuangxiangai.asia/v1", chuangxiangVideoModel(id), [
      Response.json({ request_id: "video_3", status: "queued" }), Response.json({ status: "completed" }),
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }),
    ]);
    const task = await adapter.submit(request(id, { duration: 10 }));
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://vapi.chuangxiangai.asia/v1/videos/generations");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, prompt: "Ocean sunrise", duration: 10, n: 1 });
    const state = await adapter.poll(JSON.parse(JSON.stringify(task)));
    expect(state.status).toBe("succeeded");
    expect(await adapter.extractOutputs(state.result)).toEqual([{ kind: "video", data: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }]);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://vapi.chuangxiangai.asia/v1/videos/generations/video_3");
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://vapi.chuangxiangai.asia/v1/videos/video_3/content");
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get("authorization")).toBe("Bearer mock-key");
  });
  it("uses a Secure Flow group's jobs/messages contract and omits fixed-duration fields", async () => {
    const id = "veo_quan";
    const model = remainingVideoModel("secure", id, undefined, { group: "Flow" })!;
    const { adapter, fetcher } = fixture("https://token.secure-skill.com/v1", model, [Response.json({ task_id: "flow_1", status: "queued" })], { accountKeyGroup: "Flow" });
    await adapter.submit(request(id, { duration: 8, aspect_ratio: "16:9", resolution: "1080p" }));
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://token.secure-skill.com/v1/jobs");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: id, aspect_ratio: "16:9", resolution: "1080p", messages: [{ role: "user", content: "Ocean sunrise" }] });
  });
  it.each(["https://ai.cangyuansuanli.cn", "https://vapi.chuangxiangai.asia"])("keeps accepted video responses without task IDs uncertain at %s", async baseUrl => {
    const id = "sd10-seedance-2.0", model = baseUrl.includes("cangyuan") ? cangyuanModel(id) : chuangxiangVideoModel(id);
    const { adapter, fetcher } = fixture(baseUrl, model, [Response.json({ status: "queued" })]);
    await expect(adapter.submit(request(id, { duration: 10 }))).rejects.toMatchObject({ details: { kind: "invalid_response", retryable: false, submissionMayHaveOccurred: true } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects a saved visual-understanding descriptor with stale generation operations", async () => {
    const model: ModelDescriptor = { id: "visual-understanding", name: "理解", operations: ["video.generate"], outputKinds: ["text"], metadata: { operationsSource: "declared" } };
    const { adapter, fetcher } = fixture("https://mock.invalid", model);
    const validation = await adapter.validate(request(model.id));
    expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "wrong_media_type" })]));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
