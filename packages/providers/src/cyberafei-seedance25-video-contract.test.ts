import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor, NormalizedRequest } from "./contracts";
import { StaticConnectionResolver } from "./credentials";
import { GenericRestAdapter } from "./rest";
import { remainingVideoModel, remainingVideoRequestIssues, remainingVideoTransport, normalizeRemainingVideoParameters } from "./remaining-video-contracts";
import { CYBER_SEEDANCE25_PRICE_GROUPS, cyberafeiSeedance25SizePreferenceIssues } from "./cyberafei-seedance25-video-contract";

const origin = "https://api.3365api.cn";
const request = (parameters: Record<string, unknown>): NormalizedRequest => ({ connectionId: "cyber", operation: "video.generate", model: "seedance2.5", prompt: "offline contract fixture", idempotencyKey: "offline-only", parameters });
const base: ModelDescriptor = { id: "seedance2.5", name: "seedance2.5", operations: ["video.generate"], outputKinds: ["video"] };

describe("Cyberafei own seedance2.5 price tiers and open size", () => {
  it.each(CYBER_SEEDANCE25_PRICE_GROUPS)("keeps price tier separate from wire pixels in %s", group => {
    const context = { baseUrl: origin, group, model: base };
    const model = remainingVideoModel("cyberafei", base.id, base, context)!;
    expect(model.parameters?.find(p => p.key === "resolution")).toMatchObject({ label: "计价分辨率档位", allowCustomValue: true,
      options: [{ label: "480p", value: "480p" }, { label: "720p", value: "720p" }] });
    expect(model.parameters?.find(p => p.key === "size")).toMatchObject({ control: "text", valueType: "string" });
    expect(model.parameters?.find(p => p.key === "size")).not.toHaveProperty("options");
    expect(model.metadata).not.toHaveProperty("videoDerivedSizeMappings");
    for (const resolution of ["480p", "720p", "1080p"]) {
      const parameters = { resolution, duration: 10, size: "1002x668", aspect_ratio: "3:2" };
      const saved = structuredClone(parameters);
      expect(remainingVideoRequestIssues("cyberafei", request(parameters), context)).toEqual([]);
      expect(normalizeRemainingVideoParameters("cyberafei", request(parameters), context)).toMatchObject({ seconds: 10, size: "1002x668" });
      expect(normalizeRemainingVideoParameters("cyberafei", request(parameters), context)).not.toHaveProperty("resolution");
      expect(normalizeRemainingVideoParameters("cyberafei", request(parameters), context)).not.toHaveProperty("aspect_ratio");
      expect(parameters).toEqual(saved);
    }
    const transport = remainingVideoTransport("cyberafei", base.id, context)!;
    expect(transport.submit?.mappings?.some(row => row.source.kind === "videoDimensions")).toBe(false);
    expect(transport.submit?.mappings?.map(row => row.target)).toEqual(["/model", "/prompt", "/seconds", "/size", "/input_reference"]);
  });

  it("requires independent W/H and preserves conflicts for correction", () => {
    for (const parameters of [{ resolution: "480p" }, { resolution: "720p", size: "auto" }, { aspect_ratio: "16:9" }])
      expect(cyberafeiSeedance25SizePreferenceIssues(parameters)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.size", message: expect.stringContaining("独立填写") })]));
    expect(cyberafeiSeedance25SizePreferenceIssues({ resolution: "480p", size: "1000x1000", ratio: "16:9" })).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.aspect_ratio" })]));
    expect(cyberafeiSeedance25SizePreferenceIssues({ size: "1002x668", ratio: "3:2" })).toEqual([]);
    expect(cyberafeiSeedance25SizePreferenceIssues({ size: "256x512", aspect_ratio: "1:2", aspectRatio: "2:1" })).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("字段存在冲突") })]));
    expect(cyberafeiSeedance25SizePreferenceIssues({ size: "4097x8194", aspect_ratio: "1:2" })).toEqual([]);
  });

  it("does not change neighbouring origins, groups, IDs or manual contracts", () => {
    for (const context of [{ baseUrl: "http://api.3365api.cn", group: CYBER_SEEDANCE25_PRICE_GROUPS[0] },
      { baseUrl: "https://api.3365api.cn.evil.test", group: CYBER_SEEDANCE25_PRICE_GROUPS[0] },
      { baseUrl: origin, group: "other" }, { baseUrl: origin, group: "特价seedance2.0 " }])
      expect(remainingVideoModel("cyberafei", base.id, base, context)?.metadata?.videoResolutionValueMode).toBe("derived-size");
    expect(remainingVideoModel("cyberafei", "seedance2.0", undefined, { baseUrl: origin, group: CYBER_SEEDANCE25_PRICE_GROUPS[1] })?.metadata?.videoResolutionValueMode).toBe("derived-size");
    for (const metadata of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }])
      expect(remainingVideoModel("cyberafei", base.id, { ...base, metadata }, { baseUrl: origin, group: CYBER_SEEDANCE25_PRICE_GROUPS[1] })).toBeUndefined();
    expect(remainingVideoModel("cyberafei", base.id, base, { baseUrl: origin, group: CYBER_SEEDANCE25_PRICE_GROUPS[1], manualProtocol: true })).toBeUndefined();
  });

  it("updates application price tiers from a new same-group official row without relabeling its body as the initial snapshot", () => {
    const group = CYBER_SEEDANCE25_PRICE_GROUPS[0];
    const current: ModelDescriptor = { ...base, metadata: { modelGroup: group, officialCatalogPricing: { kind: "tiered", currency: "USD",
      sourceUrl: `${origin}/api/pricing`, checkedAt: "future-real-free-read", billingUnit: "second", tiers: [
        { id: "720p", dimension: "resolution", value: "720p", price: 9 }, { id: "1080p", dimension: "resolution", value: "1080p", price: 12 }] } } };
    const model = remainingVideoModel("cyberafei", current.id, current, { baseUrl: origin, group })!;
    expect(model.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(["720p", "1080p"]);
    expect(model.metadata?.videoPriceResolutionSource).toMatchObject({ basis: "same-group-official-pricing", checkedAt: "future-real-free-read",
      initialDocumentationReadSnapshot: { checkedAt: "2026-10-11T03:36:35.347Z" } });
    expect(model.metadata?.videoPriceResolutionSource).not.toHaveProperty("rowSha256");
    expect(remainingVideoModel("cyberafei", current.id, current, { baseUrl: origin, group: CYBER_SEEDANCE25_PRICE_GROUPS[1] })?.metadata?.videoPriceResolutionTiers).toEqual(["480p", "720p"]);
  });

  it.each(CYBER_SEEDANCE25_PRICE_GROUPS)("constructs only original multipart size and rejects missing size before submit in %s", async group => {
    const model = remainingVideoModel("cyberafei", base.id, base, { baseUrl: origin, group })!;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: "offline-task", status: "queued" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "cyber", provider: "rest", baseUrl: origin, apiKey: "fixture-not-real",
      settings: { modelGroup: group, scannedModelIds: [model.id], modelCatalogModels: [model], connector: { models: [model], auth: { type: "bearer" }, submit: { path: "/old", bodyMode: "json" }, output: { path: "$.url", kind: "video" } } } }]), { fetch: fetcher });
    const parameters = { resolution: "480p", duration: 10, size: "1002x668", aspect_ratio: "3:2" };
    expect(await adapter.validate(request(parameters))).toMatchObject({ valid: true });
    expect(await adapter.validate(request({ resolution: "720p", duration: 10 }))).toMatchObject({ valid: false });
    expect(fetcher).not.toHaveBeenCalled();
    for (const resolution of ["480p", "720p"]) {
      await adapter.submit(request({ ...parameters, resolution }));
      const [url, options] = fetcher.mock.calls.at(-1)!;
      expect(String(url)).toBe(`${origin}/v1/videos`);
      const body = options?.body as FormData;
      expect(Object.fromEntries(body.entries())).toEqual({ model: "seedance2.5", prompt: "offline contract fixture", seconds: "10", size: "1002x668" });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(parameters).toEqual({ resolution: "480p", duration: 10, size: "1002x668", aspect_ratio: "3:2" });
  });
});
