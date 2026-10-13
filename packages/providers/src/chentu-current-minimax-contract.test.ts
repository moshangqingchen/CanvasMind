import { describe, expect, it, vi } from "vitest";
import { inferGenerationMediaKinds } from "./model-media.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";
import { remainingVideoModel, remainingVideoRequestIssues } from "./remaining-video-contracts.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { StaticConnectionResolver } from "./credentials.js";
import type { NormalizedRequest, ProviderAdapter } from "./contracts.js";

describe("current exact Chentu MiniMax catalog IDs", () => {
  it.each(["MiniMaxH3-768p", "MiniMaxH3-480p"])("imports %s as video and preserves open fields in the documented task chain", async id => {
    expect(inferGenerationMediaKinds(id)).toEqual(["video"]);
    const catalog = parseSupplierCatalog({ data: [{ model_name: id, quota_type: 1, model_price: 0.051, billing_mode: "per_second",
      enable_groups: ["minimax系列视频"], supported_endpoint_types: ["openai"] }], group_ratio: { "minimax系列视频": 1 } }, { supplierSiteUrl: "https://tu.988236.xyz" });
    expect(catalog.groups[0]?.models[0]?.capability).toBe("video");
    const model = remainingVideoModel("chentu", id)!;
    expect(model.parameters?.find(p => p.key === "duration")).toMatchObject({ min: 1, allowCustomValue: true });
    expect(model.parameters?.find(p => p.key === "duration")?.max).toBeUndefined();
    expect(model.limits?.maxInputImages).toBeUndefined();
    const request: NormalizedRequest = { connectionId: "native", model: id, operation: "video.image-to-video", idempotencyKey: "offline-no-paid",
      prompt: "offline original request", parameters: { duration: 17, aspect_ratio: "4:3", resolution: "768p" },
      assets: [{ id: "ref", kind: "image", mimeType: "image/png", url: "https://images.example/original.png" }] };
    expect(remainingVideoRequestIssues("chentu", request)).toEqual([]);
    const fallback = { testConnection: vi.fn(), listModels: vi.fn(), validate: vi.fn(), submit: vi.fn(), poll: vi.fn(), extractOutputs: vi.fn() } as unknown as ProviderAdapter;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ task_id: "original-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "original-task", status: "succeeded", download_url: "https://tu.988236.xyz/generated/videos/original.mp4" }));
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "native", provider: "openai", baseUrl: "https://tu.988236.xyz",
      apiKey: "offline-key", settings: { accountKeyGroup: "minimax系列视频", modelGroup: "minimax系列视频", modelScanStatus: "live", scannedModelIds: [id], modelCatalogModels: [model] } }]), fallback, { fetch: fetcher });
    const task = await adapter.submit(request);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://tu.988236.xyz/v1/videos");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ model: id, duration: 17, ratio: "4:3", resolution: "768p", images: ["https://images.example/original.png"] });
    const complete = await adapter.poll(task);
    expect(String(fetcher.mock.calls[1]![0])).toBe("https://tu.988236.xyz/v1/videos/original-task");
    expect((await adapter.extractOutputs(complete.result))[0]?.url).toBe("https://tu.988236.xyz/generated/videos/original.mp4");
    expect(fallback.submit).not.toHaveBeenCalled();
  });
});
