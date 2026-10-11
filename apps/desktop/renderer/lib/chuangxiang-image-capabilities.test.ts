import { describe, expect, it } from "vitest";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { normalizedParametersForModel } from "./model-parameters";
import { resolutionTierShortcuts } from "../components/node-parameter-fields";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { SupplierVerificationCase } from "@super-canvas/db";
import { effectiveImageCapabilities } from "./supplier-capabilities";

const connection = {
  provider: "openai",
  config: {
    baseUrl: "https://vapi.chuangxiangai.asia",
    modelGroup: "生图",
    usage: "canvas",
  },
};
const model: ModelDescriptor = {
  id: "gpt-image-2.5-flare-cf",
  name: "Flare",
  operations: ["image.generate"],
};

describe("Chuangxiang canvas controls", () => {
  it("retains original undersized samples without creating a per-tier pixel table", () => {
    const bound = bindScannedModelProtocols(connection, [{ ...model, id: "gpt-image-2.5-yf" }]).models[0]!;
    const sample: SupplierVerificationCase = {
      id: "sample", requestId: "request", supplierId: "cx", sourceId: "cx", connectionId: "cx-image",
      group: "生图", modelId: bound.id, provider: "openai", fingerprint: "fixture", dedupeKey: "sample",
      resolution: "2K", ratio: "16:9", expectedWidth: 2720, expectedHeight: 1536,
      actualWidth: 1672, actualHeight: 941, parameters: { size: "2720x1536" },
      status: "unsupported", rejectedParameter: "resolution", createdAt: "now", updatedAt: "now",
    };
    const evaluate = (test: SupplierVerificationCase, descriptor = bound) => effectiveImageCapabilities({
      supplier: { id: "cx", name: "创想AI", supplierKey: "custom", apiUrl: connection.config.baseUrl, siteUrl: connection.config.baseUrl, kind: "newapi", catalog: { groups: [{ id: "生图", label: "生图", models: [] }] }, scanStatus: "live", createdAt: "now", updatedAt: "now" },
      connection: { ...connection, id: "cx-image" }, model: { ...descriptor, metadata: { ...descriptor.metadata, imageApproximateResolutions: [] } }, fingerprint: "fixture", tests: [test],
    });
    const result = evaluate(sample);
    expect(result.tiers.map(t => t.tier)).toEqual(["1K"]);
    expect(result.model.metadata?.imageApproximateResolutions).toEqual([]);
    const size = result.model.parameters!.find(p => p.key === "size")!;
    expect(size.allowCustomValue).toBe(true);
    expect(size.options!.map(o => o.value)).toContain("3840x2160");
    expect(result.model.metadata?.imageUserSizePresetSource).toBe("user-request");
    expect(size.options!.filter(o => o.label.startsWith("2K")).length).toBeGreaterThan(0);
    expect(size.min).toBeUndefined();
    expect(size.max).toBeUndefined();
    expect(size.step).toBeUndefined();
    expect(result.evidence[0]?.kind).toBe("test");
    expect(result.evidence[0]?.checkedAt).toBe("2026-09-21");
    expect(sample.status).toBe("unsupported");
    expect(evaluate({ ...sample, actualWidth: undefined, actualHeight: undefined }).model.parameters).toEqual(result.model.parameters);
    const belowLimit = { ...sample, actualWidth: 1440, actualHeight: 810 };
    expect(evaluate(belowLimit).model.parameters).toEqual(result.model.parameters);
    expect(evaluate(belowLimit, { ...bound, metadata: { ...bound.metadata, imageUnsupportedResolutions: ["2K"] } }).model.parameters).toEqual(result.model.parameters);
  });
  it("keeps full-model historical request values and open W/H through capability merging", () => {
    const bound = bindScannedModelProtocols(connection, [{ ...model, id: "gpt-image-2.5-yf" }]).models[0]!;
    const result = effectiveImageCapabilities({
      supplier: { id: "cx", name: "创想AI", supplierKey: "custom", apiUrl: connection.config.baseUrl, siteUrl: connection.config.baseUrl, kind: "newapi", catalog: { groups: [{ id: "生图", label: "生图", models: [] }] }, scanStatus: "live", createdAt: "now", updatedAt: "now" },
      connection: { ...connection, id: "cx-image" }, model: bound, fingerprint: "fixture",
    });
    expect(result.tiers.map(t => t.tier)).toEqual(["1K"]);
    expect(result.tiers.find(t => t.tier === "4K")).toBeUndefined();
    const options = result.model.parameters!.find(p => p.key === "size")!.options!;
    expect(options.some(o => o.value === "auto")).toBe(true);
    expect(options.some(o => o.value === "2048x2048")).toBe(true);
    expect(result.model.metadata?.imageUserSizeSourceOptions).toEqual(expect.arrayContaining([expect.objectContaining({ value: "2048x2048", label: expect.stringContaining("服务错误") })]));
    expect(options.some(o => o.value === "3840x2160")).toBe(true);
    expect(result.model.metadata?.imageRequestResolutions).toEqual(["1K", "2K", "4K"]);
    expect(result.model.metadata?.imageTierSource).toBe("historical-request-output-sample");
    expect(result.model.metadata?.imageResolutionProfiles).toBeUndefined();
    expect(result.model.pricing?.unitAmount).toBe(0.08);
  });
  it("updates cached model controls without overwriting saved node values", () => {
    const result = bindScannedModelProtocols(connection, [model]).models[0]!;
    expect(
      resolutionTierShortcuts(
        result.parameters!.find((p) => p.key === "size")!,
      ).map((t) => t.label),
    ).toEqual(["1K", "2K", "4K"]);
    expect(result.metadata?.imageSupportedResolutions).toEqual(["1K", "2K", "4K"]);
    expect(result.parameters!.find(p => p.key === "size")!.allowCustomValue).toBe(true);
    expect(
      result
        .parameters!.find((p) => p.key === "quality")!
        .options!.map((o) => o.value),
    ).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(result.parameters!.find((p) => p.key === "quality")!.default).toBe(
      "max",
    );
    expect(
      normalizedParametersForModel("image-generation", "openai", result, {
        quality: "high",
        size: "auto",
        size_tier: "2K",
      }),
    ).toMatchObject({ quality: "high", size: "auto", size_tier: "2K" });
    expect(bindScannedModelProtocols(connection, [result]).models).toEqual([
      result,
    ]);
  });
  it("keeps 4K request controls despite an earlier undersized output and leaves other providers alone", () => {
    const sunburst = bindScannedModelProtocols(connection, [
      { ...model, id: "gpt-image-2.5-sunburst-cf" },
    ]).models[0]!;
    expect(
      resolutionTierShortcuts(
        sunburst.parameters!.find((p) => p.key === "size")!,
      ).map((t) => t.label),
    ).toEqual(["1K", "2K", "4K"]);
    expect(sunburst.parameters!.find(p => p.key === "size")!.options!.map(o => o.value)).toContain("3840x2160");
    expect(sunburst.parameters!.find(p => p.key === "size")!.allowCustomValue).toBe(true);
    expect(sunburst.metadata?.imageRequestResolutions).toContain("4K");
    expect(sunburst.metadata?.imageSupportedResolutions).not.toContain("4K");
    expect(sunburst.metadata?.imageUnsupportedResolutions).toEqual([]);
    expect(
      bindScannedModelProtocols(connection, [
        { ...model, id: "grok-imagine-image-quality" },
      ]).models[0]!.metadata?.imageCapabilitiesVerifiedAt,
    ).toBeUndefined();
    expect(
      bindScannedModelProtocols(
        {
          ...connection,
          config: { ...connection.config, baseUrl: "https://other.example" },
        },
        [model],
      ).models[0]!.parameters,
    ).toBeUndefined();
  });
});
