import { describe, expect, it, vi } from "vitest";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import type { ModelDescriptor, NormalizedRequest, ProviderAdapter } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { jiasuVideoModel, jiasuVideoRequestIssues } from "./jiasu-video-contract.js";
import { remainingVideoModel, remainingVideoRequestIssues, type RemainingVideoSupplier } from "./remaining-video-contracts.js";
import { seedanceDurationFallback, seedanceDurationFamily } from "./seedance-duration-fallback.js";

const request = (id: string, parameters: Record<string, unknown>): NormalizedRequest => ({ connectionId: "offline-fallback", model: id,
  operation: "video.generate", prompt: "offline fixture", idempotencyKey: "offline-only", parameters });

describe("user-authorized Seedance duration fallback", () => {
  it.each([
    ["seedance2.0-mini-A", "seedance-2.0"], ["sd-2.0-fast-J4", "seedance-2.0"], ["doubao-seedance-2-0-260128", "seedance-2.0"],
    ["seedance2.5-全参真人", "seedance-2.5"], ["SD2.5-pro", "seedance-2.5"], ["ov-seedance-2.5-720p-nv", "seedance-2.5"],
    ["doubao-seedance-2-5-260628", "seedance-2.5"], ["dreamina-seedance-2.0-fast", "seedance-2.0"],
  ])("matches only the exact family version in %s", (id, family) => expect(seedanceDurationFamily(id)).toBe(family));
  it.each(["seedance2.50", "seedance2.5.1", "seedance12.0", "seedance2.1", "notseedance2.0", "sdxl2.5", "grok-2.5", "seedance2.0-sd2.5"])("does not invent a family for %s", id => {
    expect(seedanceDurationFallback(id, {})).toBeUndefined();
  });
  it("keeps explicit enums, bounds, defaults and partial supplier constraints authoritative", () => {
    expect(seedanceDurationFallback("seedance2.5", { values: [40] })).toBeUndefined();
    expect(seedanceDurationFallback("seedance2.5", { min: 4, max: 60, default: 40 })).toBeUndefined();
    expect(seedanceDurationFallback("seedance2.5", { min: 4, default: 10 })).toEqual({ family: "seedance-2.5", min: 4, max: 30 });
    expect(seedanceDurationFallback("seedance2.5", { max: 60, default: 40 })).toEqual({ family: "seedance-2.5", min: 1, max: 60 });
    expect(seedanceDurationFallback("seedance2.5", { default: 40 })).toBeUndefined();
    expect(seedanceDurationFallback("seedance2.0", { min: 20 })).toBeUndefined();
  });

  const cases: { supplier: RemainingVideoSupplier; baseUrl: string; id: string; max: number; group?: string }[] = [
    { supplier: "jiasu", baseUrl: "https://ai.jiasuapi.com/v1", id: "seedance2.5-全参真人", max: 30, group: "vip" },
    { supplier: "jiasu", baseUrl: "https://ai.jiasuapi.com/v1", id: "sd-2.0-fast-803-J3", max: 15, group: "vip" },
    { supplier: "secure", baseUrl: "https://token.secure-skill.com", id: "seedance2.0", max: 15, group: "sd特价分组1" },
    { supplier: "cyberafei", baseUrl: "https://api.3365api.cn", id: "seedance2.0", max: 15 },
    { supplier: "cyberafei", baseUrl: "https://api.3365api.cn", id: "seedance2.5", max: 30 },
  ];
  it.each(cases)("keeps UI and actual native request validation aligned offline for $supplier / $id", async entry => {
    const context = { group: entry.group }, model = remainingVideoModel(entry.supplier, entry.id, undefined, context)!;
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 1, max: entry.max, step: 1 });
    expect(model.metadata).toMatchObject({ durationRangeSource: "user-fallback", durationRangeUnverified: false, userFallbackDurationRange: { min: 1, max: entry.max } });
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "offline-task", status: "queued" }));
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "offline-fallback", provider: "openai", apiKey: "offline-only", baseUrl: entry.baseUrl,
      settings: { modelCatalogModels: [model], modelScanStatus: "live", scannedModelIds: [entry.id], modelGroup: entry.group } }]), {} as ProviderAdapter, { fetch: fetcher });
    for (const value of [0, entry.max + 1, 35, 38, 1.5]) {
      const input = request(entry.id, { duration: value });
      expect((await adapter.validate(input)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
      await expect(adapter.submit(input)).rejects.toThrow();
      expect(input.parameters).toEqual({ duration: value });
    }
    expect(fetcher).not.toHaveBeenCalled();
    for (const value of [1, entry.max]) {
      const input = request(entry.id, { duration: value });
      expect(await adapter.validate(input)).toMatchObject({ valid: true });
      await adapter.submit(input);
      const body = fetcher.mock.lastCall?.[1]?.body;
      if (body instanceof FormData) {
        expect(body.get("model")).toBe(entry.id);
        expect(body.get("seconds")).toBe(String(value));
      } else expect(JSON.parse(String(body))).toMatchObject({ model: entry.id, duration: value });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("replaces stale fallback provenance with current exact Jiasu schema and retains conditional restrictions", () => {
    const id = "seedance2.5-全参真人", old = jiasuVideoModel(id)!;
    const price = { billingUnit: "request", priceLabel: "supplier-specific" };
    const current = jiasuVideoModel(id, { ...old, metadata: { ...old.metadata, ...price,
      jiasuCatalogRecord: { apiParameters: [{ name: "duration", range: "4-60", default: "40" }] } } })!;
    expect(current.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 4, max: 60, default: 40 });
    expect(current.metadata).not.toHaveProperty("durationRangeSource");
    expect(current.metadata).not.toHaveProperty("userFallbackDurationRange");
    expect(current.metadata).toMatchObject(price);
    expect(jiasuVideoRequestIssues(request(id, { duration: 40 }), current)).toEqual([]);
    expect(jiasuVideoModel("sd-2.0-mini-J1")?.metadata).not.toHaveProperty("durationRangeSource");
    expect(jiasuVideoRequestIssues(request("sd-2.0-mini-J1", { duration: 15, resolution: "720p" }))).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    const vivid = remainingVideoModel("secure", "seedance2.0", remainingVideoModel("secure", "seedance2.0", undefined, { group: "sd特价分组1" }), { group: "vividai-video" })!;
    expect(vivid.metadata).not.toHaveProperty("durationRangeSource");
    expect(vivid.parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([15]);
    expect(remainingVideoRequestIssues("secure", request(vivid.id, { duration: 1 }), { group: "vividai-video" })).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
  });

  it("preserves partial declarations and an incompatible documented default without falsely labeling it as fallback", () => {
    const id = "seedance2.5-全参真人";
    const model = (duration: Record<string, unknown>): ModelDescriptor => ({ id, name: id, operations: [], metadata: { jiasuCatalogRecord: { apiParameters: [{ name: "duration", ...duration }] } } });
    expect(jiasuVideoModel(id, model({ minimum: 4, default: 10 }))?.parameters?.[0]).toMatchObject({ min: 4, max: 30, default: 10 });
    const incompatible = jiasuVideoModel(id, model({ default: 40 }))!;
    expect(incompatible.metadata?.durationRangeUnverified).toBe(true);
    expect(incompatible.metadata).not.toHaveProperty("durationRangeSource");
    expect(jiasuVideoRequestIssues(request(id, {}), incompatible)).toEqual([]);
    expect(jiasuVideoRequestIssues(request(id, { duration: 29 }), incompatible)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    const other = { id: "official-other-video", name: "other", operations: [], metadata: { endpointTypes: ["openai-video"] } };
    expect(jiasuVideoModel(other.id, other)?.metadata?.durationRangeUnverified).toBe(true);
    expect(jiasuVideoModel(other.id, other)?.metadata).not.toHaveProperty("durationRangeSource");
  });
});
