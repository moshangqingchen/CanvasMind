import { describe, expect, it, vi } from "vitest";
import type { SupplierRecord, SupplierVerificationCase } from "@super-canvas/db";
import { OpenAIImageAdapter, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";
import { effectiveImageCapabilities, verificationParameters } from "./supplier-capabilities";

const group = "生图（2k4k 高质量）";
const description = "image2 0.1一张 能高质量\nimage2.5 flare 0.13一张 支持五档质量\nimage2.5 sub 0.16一张 支持五档质量";
const values = ["auto", "low", "medium", "high", "xhigh", "max"];
const supplier: SupplierRecord = {
  id: "mikoto", name: "MikotoPro", supplierKey: "mikoto", apiUrl: "https://api.mikoto.vip",
  siteUrl: "https://api.mikoto.vip", kind: "newapi", scanStatus: "live", createdAt: "now", updatedAt: "now",
  catalog: { groups: [{ id: group, label: group, models: [], details: { source: "model-plaza", description } }] },
};
const connection = { id: "key-a", provider: "openai", config: { accountKeyGroup: group } };
const cached = (id: string): ModelDescriptor => ({
  id, name: id, operations: ["image.generate"], metadata: { imageCapabilityPolicy: 2, qualitySupport: "declared" },
  parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] }],
});
const get = (model: ModelDescriptor, extra: Partial<Parameters<typeof effectiveImageCapabilities>[0]> = {}) =>
  effectiveImageCapabilities({ supplier, connection, model, fingerprint: "f", ...extra });

describe("Mikoto Image 2.5 quality declarations", () => {
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("restores all qualities for live and cached %s", id => {
    for (const model of [{ ...cached(id), parameters: [] }, cached(id)]) {
      const result = get(model);
      expect(result.model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "max", options: values.map(value => ({ value })) });
      expect(result.qualityOptions?.filter(value => value !== "auto")).toEqual(values.slice(1));
      expect(verificationParameters(result, "4K").parameters).toMatchObject({ quality: "max", size: "3840x2160" });
      expect(result.evidence.some(item => item.kind === "test" || item.status === "verified")).toBe(false);
      expect(get(result.model).model.parameters).toEqual(result.model.parameters);
    }
  });
  it("does not use a generic group label as an Image 2.5 ceiling", () => {
    const result = get({ ...cached("gpt-image-2.5-sunburst"), parameters: [] }, {
      supplier: { ...supplier, catalog: { groups: [] } },
    });
    expect(result.quality).toBe("max");
    expect(result.needsQualityProbe).toBe(true);
  });
  it("does not transfer one model's five-level declaration to another model or a fixed SKU", () => {
    const flareOnly: SupplierRecord = { ...supplier, catalog: { groups: [{ id: group, label: group, models: [],
      details: { source: "model-plaza", description: "image2.5 flare 支持五档质量" } }] } };
    expect(get(cached("gpt-image-2.5-sunburst"), { supplier: flareOnly }).quality).toBe("high");
    expect(get(cached("gpt-image-2.5-flare-high")).quality).toBe("high");
  });
  it.each([["生图（2k4k 高质量）", "high"], ["生图（2k4k 中质量）", "medium"]])("keeps Image 2 fixed in %s", (name, quality) => {
    const result = get({ ...cached("gpt-image-2"), parameters: [] }, { connection: { ...connection, config: { accountKeyGroup: name } } });
    expect(result.model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: quality, options: [{ value: quality }] });
  });
  it("retains explicit documentation and exact-key API rejections", () => {
    const model = cached("gpt-image-2.5-sunburst");
    const denied = get(model, { documentation: "不支持 max；不支持 low" });
    expect(denied.quality).toBe("xhigh");
    expect(denied.model.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["medium", "high", "xhigh"]);
    const rejection: SupplierVerificationCase = {
      id: "rejected", requestId: "request", supplierId: supplier.id, sourceId: "source", connectionId: connection.id,
      group, modelId: model.id, provider: "openai", fingerprint: "f", dedupeKey: "d", resolution: "4K", ratio: "16:9",
      expectedWidth: 3840, expectedHeight: 2160, quality: "max", parameters: { quality: "max" },
      status: "unsupported", rejectedParameter: "quality", legalQualities: ["medium", "high"], createdAt: "now", updatedAt: "now",
    };
    const restricted = get(model, { tests: [rejection] });
    expect(restricted.quality).toBe("high");
    expect(restricted.qualityOptions).toEqual(["medium", "high"]);
    expect(restricted.model.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["medium", "high"]);
    expect(get(model, { tests: [{ ...rejection, connectionId: "another-key" }] }).quality).toBe("max");
  });
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("forwards every restored quality to the mocked %s request", async id => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{
      id: connection.id, provider: "openai", apiKey: "isolated-test-key", baseUrl: supplier.apiUrl,
      settings: { supplierKey: "mikoto", modelGroup: group },
    }]), { fetch: fetchMock });
    for (const quality of get(cached(id)).qualityOptions!) {
      const request = { connectionId: connection.id, operation: "image.generate" as const, model: id,
        prompt: "mock transport validation", idempotencyKey: `mock-${id}-${quality}`, parameters: { size: "3840x2160", quality } };
      expect((await adapter.validate(request)).valid).toBe(true);
      await adapter.submit(request);
      expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ model: id, quality, size: "3840x2160" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
