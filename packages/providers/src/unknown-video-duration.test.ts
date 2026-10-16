import { describe, expect, it, vi } from "vitest";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import type { ProviderAdapter } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { normalizeRemainingVideoParameters, remainingVideoModel, remainingVideoRequestIssues, type RemainingVideoSupplier } from "./remaining-video-contracts.js";

const unconfirmed: { supplier: RemainingVideoSupplier; baseUrl: string; ids: string[]; required?: boolean; group?: string }[] = [
  { supplier: "chentu", baseUrl: "https://tu.988236.xyz", ids: ["sora-v3-pro"], required: true },
  { supplier: "chentu", baseUrl: "https://tu.988236.xyz", ids: ["grok-video1.5-fast", "grok--video1.0", "minimax-h3 768p"] },
  { supplier: "cyberafei", baseUrl: "https://api.3365api.cn", ids: ["minimax-h3", "veo3.1", "veo3.1-fast", "veo3.1-lite", "omni-flash"] },
  { supplier: "mikoto", baseUrl: "https://api.mikoto.vip", ids: ["grok-imagine-video", "grok-imagine-video-1.5"] },
  { supplier: "hangzhale", baseUrl: "https://api.hangzhale.com", ids: ["grok-imagine-video", "grok-imagine-video-1.5"] },
];
const cases = unconfirmed.flatMap(entry => entry.ids.map(id => ({ ...entry, id })));

describe("documented native duration fields without exhaustive ranges", () => {
  it("updates Chentu's newly documented 3–15 second Grok range while preserving an old out-of-range input", () => {
    const id = "grok-imagine-video-1.5（按次）";
    const model = remainingVideoModel("chentu", id, { id, name: id, operations: ["video.generate"], metadata: { durationRangeUnverified: true } })!;
    expect(model.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 3, max: 15 });
    expect(model.metadata?.durationRangeUnverified).toBeUndefined();
    const request = { connectionId: "offline", model: id, operation: "video.generate" as const, prompt: "offline", idempotencyKey: "no-submit", parameters: { duration: 38 } };
    expect(normalizeRemainingVideoParameters("chentu", request).duration).toBe(38);
    expect(remainingVideoRequestIssues("chentu", request)).toEqual(expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]));
    expect(remainingVideoRequestIssues("chentu", { ...request, parameters: { duration: 15 } })).toEqual([]);
    expect(request.parameters.duration).toBe(38);
  });
  it.each(cases)("preserves typed $supplier / $id durations and never invents a default", async entry => {
    const context = { group: entry.group }, model = remainingVideoModel(entry.supplier, entry.id, undefined, context)!;
    const duration = model.parameters!.find(parameter => parameter.key === "duration")!;
    expect(duration.default).toBeUndefined();
    expect(duration.required).toBe(Boolean(entry.required));
    expect(model.metadata?.durationRangeUnverified).toBe(true);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "offline-task", status: "queued" }));
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ id: "offline", provider: "openai", apiKey: "offline-only", baseUrl: entry.baseUrl,
      settings: { modelCatalogModels: [model], modelScanStatus: "live", scannedModelIds: [entry.id], modelGroup: entry.group } }]),
    {} as ProviderAdapter, { fetch: fetcher });
    const request = (parameters: Record<string, unknown>) => ({ connectionId: "offline", model: entry.id, operation: "video.generate" as const,
      prompt: "offline fixture", idempotencyKey: "never-submit", parameters });
    for (const parameters of [{ duration: 38 }, { duration: 1_000_000 }, { seconds: 38 }]) {
      const input = request(parameters);
      if (entry.required) {
        expect(await adapter.validate(input)).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]) });
        await expect(adapter.submit(input)).rejects.toThrow();
      } else {
        expect(duration.allowCustomValue).toBe(true);
        expect(await adapter.validate(input)).toMatchObject({ valid: true });
        await adapter.submit(input);
        const field = ["cyberafei", "mikoto"].includes(entry.supplier) ? "seconds" : "duration";
        const value = parameters.duration ?? parameters.seconds;
        const body = fetcher.mock.calls.at(-1)?.[1]?.body;
        if (body instanceof FormData) expect(body.get(field)).toBe(String(value));
        else expect(JSON.parse(String(body))[field]).toBe(value);
      }
      expect(input.parameters).toEqual(parameters);
    }
    fetcher.mockClear();
    for (const duration of [0, -1, 2.5, "5"]) {
      expect((await adapter.validate(request({ duration }))).valid).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
    const omitted = request({}), normalized = normalizeRemainingVideoParameters(entry.supplier, omitted, context);
    expect(normalized).not.toHaveProperty("duration");
    expect(normalized).not.toHaveProperty("seconds");
    const omittedIssues = remainingVideoRequestIssues(entry.supplier, omitted, context);
    expect(omittedIssues.some(issue => issue.path === "parameters.duration")).toBe(Boolean(entry.required));
    expect((await adapter.validate(omitted)).valid).toBe(!entry.required);
  });

  it("uses the confirmed group-specific fixed duration even if the old group had no range", () => {
    const old = remainingVideoModel("secure", "seedance2.0", undefined, { group: "sd特价分组1" })!;
    const current = remainingVideoModel("secure", old.id, old, { group: "vividai-video" })!;
    expect(current.parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([15]);
    expect(current.metadata).not.toHaveProperty("durationRangeUnverified");
    expect(remainingVideoRequestIssues("secure", { connectionId: "offline", model: old.id, operation: "video.generate", prompt: "offline",
      idempotencyKey: "never-submit", parameters: { duration: 15 } }, { group: "vividai-video" })).toEqual([]);
  });
});
