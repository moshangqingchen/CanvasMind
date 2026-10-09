import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver, type NormalizedRequest } from "@super-canvas/providers";
import { miaowuCatalogFromPricing, miaowuConnectorForModels, miaowuModelsForGroup } from "./miaowu-catalog";
import { applyMiaowuVideoSchema, parseMiaowuVideoSchema, type MiaowuVideoSchemaReceipt } from "./miaowu-video-schema";
const fixture = JSON.parse(readFileSync(new URL("./miaowu-video-20261009.fixture.json", import.meta.url), "utf8"));
function receipt(id: string): MiaowuVideoSchemaReceipt {
  return { id, sourceUrl: `https://api.miaowuai.store/v1/dream/model_schema?model=${encodeURIComponent(id)}`, checkedAt: "2026-10-09", status: "live",
    contract: parseMiaowuVideoSchema(id, { id, type: "video", ...fixture.schemas[id] }) };
}
const publicModels = () => miaowuModelsForGroup(miaowuCatalogFromPricing(fixture.pricing), "default");

describe("exact authenticated Miaowu video schemas", () => {
  it("applies all eleven own-model contracts and rejects mismatched IDs, undeclared fields or unsupported schema types", () => {
    for (const model of publicModels()) {
      const current = applyMiaowuVideoSchema(model, receipt(model.id));
      expect(current.metadata).toMatchObject({ parameterSource: "dream.video_schema", canvasRunnable: true, videoSchemaStatus: "live", clampNumericParameters: false });
      expect(current.pricing).toEqual(model.pricing);
    }
    const id = "seedance-2.5-pro", payload = { id, type: "video", ...structuredClone(fixture.schemas[id]) };
    expect(() => parseMiaowuVideoSchema("different-id", payload)).toThrow("同一完整视频型号");
    const unknown = structuredClone(payload);
    unknown.request_schema.properties.params.properties.unpublished = { type: "string" };
    expect(() => parseMiaowuVideoSchema(id, unknown)).toThrow("尚未接入");
    const invalid = structuredClone(payload);
    invalid.request_schema.properties.params.properties.seconds["x-dream-integer-string-max"] = 0;
    expect(() => parseMiaowuVideoSchema(id, invalid)).toThrow("时长范围");
    const unrelated = publicModels()[0]!;
    expect(applyMiaowuVideoSchema(unrelated, receipt(id))).toEqual(unrelated);
  });
  it("preserves explicit manual, paid and denied contracts and reports per-model failures without inventing controls", () => {
    const model = publicModels().find(model => model.id === "seedance-2.5-pro")!;
    for (const metadata of [{ source: "manual" }, { protocolEvidence: "paid-test" }, { canvasRunnable: false, canvasUnavailableReason: "403 权限不足" }]) {
      const protectedModel = { ...model, metadata: { ...model.metadata, ...metadata } };
      expect(applyMiaowuVideoSchema(protectedModel, receipt(model.id))).toEqual(protectedModel);
    }
    const failed = applyMiaowuVideoSchema(model, { ...receipt(model.id), status: "failed", contract: undefined, error: "HTTP 500" });
    expect(failed.parameters).toEqual(model.parameters);
    expect(failed.metadata).toMatchObject({ videoSchemaStatus: "failed", videoSchemaError: "HTTP 500" });
  });
  it("enforces 5k Unicode characters, 4–29 seconds, ratios and reference counts before any paid request", async () => {
    const model = applyMiaowuVideoSchema(publicModels().find(model => model.id === "seedance-2.5-pro")!, receipt("seedance-2.5-pro"));
    const connector = miaowuConnectorForModels([model]), fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected paid request"); });
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "same-key", provider: "rest", baseUrl: "https://api.miaowuai.store", apiKey: "synthetic-key", settings: { connector, modelCatalogModels: [model], scannedModelIds: [model.id], modelScanStatus: "live" } }]), { fetch: fetcher });
    const request: NormalizedRequest = { connectionId: "same-key", idempotencyKey: "isolated", model: model.id, operation: "video.generate", prompt: "🌊".repeat(5000), parameters: { duration: 29, resolution: "720p", aspect_ratio: "16:9" } };
    expect((await adapter.validate(request)).valid).toBe(true);
    for (const invalid of [
      { ...request, prompt: `${request.prompt}x` },
      { ...request, parameters: { ...request.parameters, duration: 30 } },
      { ...request, parameters: { ...request.parameters, duration: 3 } },
      { ...request, parameters: { ...request.parameters, aspect_ratio: "21:9" } },
      { ...request, parameters: { ...request.parameters, resolution: "1080p" } },
      { ...request, parameters: { ...request.parameters, seed: 42 } },
      { ...request, assets: Array.from({ length: 31 }, (_, i) => ({ id: String(i), kind: "image" as const, mimeType: "image/png", url: `https://media.example/${i}.png` })) },
      { ...request, assets: [{ id: "video", kind: "video" as const, mimeType: "video/mp4", url: "https://media.example/source.mp4" }] },
    ]) {
      expect((await adapter.validate(invalid)).valid).toBe(false);
      await expect(adapter.submit(invalid)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the schema's resolution-duration condition and keeps request prices independent of seconds", async () => {
    const mini = applyMiaowuVideoSchema(publicModels().find(model => model.id === "seedance-2.0-mini-deal")!, receipt("seedance-2.0-mini-deal"));
    expect(mini.parameters?.find(parameter => parameter.key === "duration")?.constraints).toEqual([{ when: [{ parameter: "resolution", values: ["480p"] }], min: 5, max: 10 }]);
    expect(mini.pricing).toMatchObject({ kind: "per-request", currency: "CNY", billingUnit: "request" });
  });
});
