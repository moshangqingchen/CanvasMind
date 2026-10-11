import { describe, expect, it, vi } from "vitest";
import type { NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { isRemainingVideoModel, normalizeRemainingVideoParameters, remainingVideoModel, remainingVideoRequiresPublicUrls, remainingVideoRequestIssues, remainingVideoTransport } from "./remaining-video-contracts.js";

const context = { group: "muse-video" };
const request = (parameters: Record<string, unknown> = {}, assets: ProviderAssetInput[] = []): NormalizedRequest => ({
  connectionId: "muse", model: "muse-video", operation: assets.length ? "video.image-to-video" : "video.generate",
  prompt: "A calm camera move.", idempotencyKey: "free-schema-fixture", parameters, assets,
});
const image = (id: number, url = `https://media.example/${id}.png`): ProviderAssetInput => ({ id: `image-${id}`, kind: "image", mimeType: "image/png", url });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

describe("Secure Muse's current official contract", () => {
  it("requires the exact Muse model and group without granting another Key's permission", () => {
    expect(isRemainingVideoModel("secure", "muse-video", context)).toBe(true);
    expect(isRemainingVideoModel("secure", "muse-video", { group: "Muse" })).toBe(true);
    expect(isRemainingVideoModel("secure", "muse-video", { group: "flow" })).toBe(false);
    expect(isRemainingVideoModel("secure", "muse-video")).toBe(false);
    expect(isRemainingVideoModel("secure", "muse-video-preview", context)).toBe(false);
    expect(isRemainingVideoModel("frimodel", "muse-video", context)).toBe(false);
    expect(remainingVideoModel("secure", "muse-video", undefined, context)).toMatchObject({
      id: "muse-video", limits: { maxInputVideos: 0, maxInputAudios: 0 },
      metadata: { videoMinDuration: 1, videoMaxDuration: 30, billingUnit: "second", generationVerified: false, videoContractCheckedAt: "2026-10-10" },
    });
    expect(remainingVideoRequiresPublicUrls("secure", "muse-video", context)).toBe(false);
  });

  it("keeps omitted ratio and resolution absent and accepts only documented duration aliases", () => {
    expect(normalizeRemainingVideoParameters("secure", request(), context)).toEqual({ duration: 6 });
    expect(normalizeRemainingVideoParameters("secure", request({ video_length: "30s", aspectRatio: "portrait", resolution: "720P", extra: "cinematic", timeout: 60, stream: false }), context))
      .toEqual({ duration: 30, aspect_ratio: "9:16", resolution: "720P", extra: "cinematic", timeout: 60, stream: false });
    expect(normalizeRemainingVideoParameters("secure", request({ aspect_ratio: "1:1", size: "1280x720" }), context)).toEqual({ duration: 6, aspect_ratio: "16:9" });
    expect(normalizeRemainingVideoParameters("secure", request({ size: "unpublished", unknown: true }), context)).toEqual({ duration: 6 });
    const transport = remainingVideoTransport("secure", "muse-video", context)!;
    expect(transport.submit?.bodyMode).toBe("json");
    expect(transport.submit?.mappings?.map(mapping => mapping.target)).not.toContain("/size");
  });

  it("deduplicates every image alias and accepts original bytes without temporary hosting", () => {
    const repeated = Array.from({ length: 12 }, (_, id) => image(id, "https://media.example/same.png"));
    const r = request({ images: ["https://media.example/same.png"], image_url: { image_url: { url: "https://media.example/same.png" } },
      reference_images: [{ b64_json: "aW1hZ2U=" }] }, [...repeated, { id: "bytes", kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from("image")) }]);
    expect(normalizeRemainingVideoParameters("secure", r, context).reference_images).toEqual(["aW1hZ2U=", "https://media.example/same.png"]);
    expect(remainingVideoRequestIssues("secure", r, context)).toEqual([]);
    expect(remainingVideoRequestIssues("secure", request({}, Array.from({ length: 11 }, (_, id) => image(id))), context))
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: "assets", message: "Muse 去重后的参考图最多 10 张。" })]));
  });

  it.each([{ duration: 0 }, { duration: 31 }, { duration: 1.5 }, { duration: "wrong" }, { seconds: 6, video_length: 10 },
    { resolution: 1080 }, { extra: 3 }, { timeout: 0 }, { timeout: 2.5 }, { stream: true }, { reference_videos: ["https://media.example/a.mp4"] },
    { reference_audios: ["https://media.example/a.mp3"] }, { first_frame: "https://media.example/a.png" }, { reference_images: [{}] }])
    ("rejects invalid or different-mode inputs before submitting: %j", parameters => {
      expect(remainingVideoRequestIssues("secure", request(parameters), context).length).toBeGreaterThan(0);
    });

  it.each(["720p", "1080p", "4K"])("keeps documented free-string resolution %s in the submitted request", async resolution => {
    const model = remainingVideoModel("secure", "muse-video", undefined, context)!;
    expect(model.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ control: "text", valueType: "string" });
    expect(remainingVideoRequestIssues("secure", request({ resolution }), context)).toEqual([]);
    const native = remainingVideoTransport("secure", "muse-video", context)!;
    const connector: RestConnectorConfig = { auth: { type: "bearer" }, allowedHosts: ["token.secure-skill.com"], models: [model],
      submit: { path: "/unused", method: "POST", bodyMode: "json" }, output: { path: "$.unused", kind: "video" }, ...native };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ task_id: "fixture-only", status: "queued" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "muse", provider: "rest", baseUrl: "https://token.secure-skill.com", apiKey: "fixture-only",
      settings: { connector, modelGroup: "muse-video", usage: "canvas", modelScanStatus: "live", scannedModelIds: ["muse-video"] } }]), { fetch: fetcher });
    const input = request({ resolution });
    expect((await adapter.validate(input)).valid).toBe(true);
    await adapter.submit(input);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).resolution).toBe(resolution);
    expect(input.parameters).toEqual({ resolution });
  });

  it("constructs submission, polls the original task and keeps the upstream result URL", async () => {
    const model = remainingVideoModel("secure", "muse-video", undefined, context)!;
    const config: RestConnectorConfig = { auth: { type: "bearer" }, allowedHosts: ["token.secure-skill.com"], models: [model],
      submit: { path: "/unused", method: "POST", bodyMode: "json" }, output: { path: "$.unused", kind: "video" } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: "muse-task", task_id: "muse-task", status: "queued" }))
      .mockResolvedValueOnce(json({ task_id: "muse-task", status: "in_progress", progress: 99 }))
      .mockResolvedValueOnce(json({ task_id: "muse-task", status: "completed", output: [{ url: "https://upstream.example/original.mp4" }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "muse", provider: "rest", baseUrl: "https://token.secure-skill.com", apiKey: "fixture-muse-key",
      settings: { connector: config, modelGroup: "muse-video", usage: "canvas", modelScanStatus: "live", scannedModelIds: ["muse-video"] } }]), { fetch: fetcher });
    const r = request({ duration: 30, aspect_ratio: "9:16", resolution: "720p", extra: "cinematic", timeout: 60 },
      [{ id: "bytes", kind: "image", mimeType: "image/png", data: new Uint8Array(Buffer.from("image")) }]);
    expect((await adapter.validate(r)).valid).toBe(true);
    const repeated = request({}, Array.from({ length: 12 }, (_, id) => image(id, "https://media.example/same.png")));
    expect((await adapter.validate(repeated)).valid).toBe(true);
    expect((await adapter.validate(request({}, Array.from({ length: 11 }, (_, id) => image(id))))).valid).toBe(false);
    const task = await adapter.submit(r);
    expect(task.status).toBe("queued");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://token.secure-skill.com/v1/videos");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: "muse-video", prompt: r.prompt, duration: 30, aspect_ratio: "9:16", resolution: "720p",
      reference_images: ["data:image/png;base64,aW1hZ2U="], extra: "cinematic", timeout: 60 });
    const running = await adapter.poll(task);
    expect(running.status).toBe("running");
    const complete = await adapter.poll(running);
    expect(complete.status).toBe("succeeded");
    expect(await adapter.extractOutputs(complete.result)).toEqual([{ kind: "video", url: "https://upstream.example/original.mp4", mimeType: "video/mp4" }]);
    for (const call of fetcher.mock.calls) expect(new Headers(call[1]?.headers).get("authorization")).toBe("Bearer fixture-muse-key");
    expect(fetcher.mock.calls.slice(1).map(call => call[0])).toEqual(["https://token.secure-skill.com/v1/videos/muse-task", "https://token.secure-skill.com/v1/videos/muse-task"]);
  });

  it("retrieves content with the original task's Key after a successful terminal response", async () => {
    const native = remainingVideoTransport("secure", "muse-video", context)!;
    const config: RestConnectorConfig = { auth: { type: "bearer" }, allowedHosts: ["token.secure-skill.com"],
      submit: { path: "/v1/videos", method: "POST", bodyMode: "json" }, ...native };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "video/mp4" } }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "muse", provider: "rest", baseUrl: "https://token.secure-skill.com", apiKey: "original-muse-key", settings: { connector: config } }]), { fetch: fetcher });
    const envelope = { connectionId: "muse", baseUrl: "https://token.secure-skill.com", config, taskId: "original-muse-task", remote: { status: "completed" } };
    expect(await adapter.extractOutputs({ ...envelope, status: "running" })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await adapter.extractOutputs({ ...envelope, status: "succeeded" })).toEqual([{ kind: "video", mimeType: "video/mp4", data: new Uint8Array([1, 2]) }]);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://token.secure-skill.com/v1/videos/original-muse-task/content");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer original-muse-key");
  });
});
