import { describe, expect, it, vi } from "vitest";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import type { ModelDescriptor, ProviderAdapter } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { remainingVideoModel, type RemainingVideoSupplier } from "./remaining-video-contracts.js";

const entries: { supplier: RemainingVideoSupplier; baseUrl: string; ids: string[] }[] = [
  { supplier: "chentu", baseUrl: "https://tu.988236.xyz", ids: ["grok-imagine-video-1.5（按次）", "grok-video1.5-fast", "grok--video1.0", "minimax-h3 768p",
    "MiniMaxH3", "MiniMaxH3-720p", "MiniMaxH3-2k", "MiniMaxH3-2k-pro", "H3量化版", "minimax_h3-768p-933", "a-2.0-720p-v1", "a-2.0-720p-v4", "sd-2.5-M-720p", "xinghe-2.0s", "sd-2.0-720p-TJ"] },
  { supplier: "cyberafei", baseUrl: "https://api.3365api.cn", ids: ["minimax-h3", "seedance2.0", "seedance2.5", "veo3.1", "veo3.1-fast", "veo3.1-lite", "omni-flash"] },
  { supplier: "mikoto", baseUrl: "https://api.mikoto.vip", ids: ["grok-imagine-video", "grok-imagine-video-1.5"] },
  { supplier: "hangzhale", baseUrl: "https://api.hangzhale.com", ids: ["grok-imagine-video", "grok-imagine-video-1.5"] },
];
const cases = entries.flatMap(entry => entry.ids.map(id => ({ ...entry, id })));
function fixture(supplier: RemainingVideoSupplier, baseUrl: string, id: string, current?: ModelDescriptor) {
  const model = remainingVideoModel(supplier, id, current)!;
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "offline-task", status: "queued" }));
  const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "offline", provider: "openai", apiKey: "offline-only", baseUrl,
    settings: { modelCatalogModels: [model], modelScanStatus: "live", scannedModelIds: [id] } }]), {} as ProviderAdapter, { fetch: fetcher });
  const request = (parameters: Record<string, unknown>) => ({ connectionId: "offline", model: id, operation: "video.generate" as const,
    prompt: "offline fixture", idempotencyKey: "offline-only", parameters });
  return { model, adapter, fetcher, request };
}

describe("unconfirmed video resolution fields", () => {
  it.each(cases)("rejects stale resolution before HTTP for $supplier / $id while allowing omission", async entry => {
    const f = fixture(entry.supplier, entry.baseUrl, entry.id);
    expect(f.model.metadata?.resolutionRangeUnverified).toBe(true);
    expect(f.model.parameters?.find(parameter => parameter.key === "resolution")?.default).toBeUndefined();
    for (const resolution of ["720p", "4K", "invented"]) {
      const input = f.request({ resolution });
      expect(await f.adapter.validate(input)).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ path: "parameters.resolution" })]) });
      await expect(f.adapter.submit(input)).rejects.toThrow();
      expect(input.parameters).toEqual({ resolution });
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.adapter.validate(f.request({}))).toMatchObject({ valid: true });
  });

  it.each(["cyberafei", "miaowu"] as const)("keeps a future %s OpenAI Video alias's unconfirmed resolution guarded", async supplier => {
    const id = "future-documented-video", baseUrl = supplier === "cyberafei" ? "https://api.3365api.cn" : "https://api.miaowuai.store";
    const current: ModelDescriptor = { id, name: id, operations: ["video.generate"], outputKinds: ["video"], metadata: { endpointTypes: ["openai-video"] } };
    const f = fixture(supplier, baseUrl, id, current);
    expect(f.model.metadata?.resolutionRangeUnverified).toBe(true);
    expect(await f.adapter.validate(f.request({ resolution: "720p" }))).toMatchObject({ valid: false });
    expect(await f.adapter.validate(f.request({}))).toMatchObject({ valid: true });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(["cyberafei", "mikoto"] as const)("preserves %s's separately documented multipart size field", async supplier => {
    const f = supplier === "cyberafei" ? fixture(supplier, "https://api.3365api.cn", "veo3.1") : fixture(supplier, "https://api.mikoto.vip", "grok-imagine-video");
    for (const size of ["720p", "0x720", "1280.5x720"]) {
      expect(await f.adapter.validate(f.request({ size }))).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ path: "parameters.size" })]) });
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.adapter.submit(f.request({ size: "1280x720" }));
    const body = f.fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("size")).toBe("1280x720");
    expect(body.has("resolution_name")).toBe(false);
    expect(body.has("resolution")).toBe(false);
  });

  it("clears only an obsolete resolution warning when the fresh exact contract declares an enum", () => {
    const id = "seedance-2.0-720p", current: ModelDescriptor = { id, name: id, operations: ["video.generate"], metadata: { resolutionRangeUnverified: true } };
    const model = remainingVideoModel("chentu", id, current)!;
    expect(model.metadata).not.toHaveProperty("resolutionRangeUnverified");
    expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["720p"]);
    expect(current.metadata?.resolutionRangeUnverified).toBe(true);
  });
});
