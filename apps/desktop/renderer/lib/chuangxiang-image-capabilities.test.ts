import { describe, expect, it } from "vitest";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { parametersWithDefaults } from "./model-parameters";
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
  it("keeps 2K request presets after a decoded undersized result, but respects API parameter rejections", () => {
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
    expect(result.tiers.map(t => t.tier)).toEqual(["1K", "2K", "4K"]);
    expect(result.tiers.find(t => t.tier === "2K")?.status).toBe("approximate");
    expect(result.model.parameters!.find(p => p.key === "size")!.options!.filter(o => o.label.startsWith("2K"))).toHaveLength(11);
    expect(result.evidence.find(e => e.resolution === "2K")?.excerpt).toContain("实际 1672×941");
    expect(sample.status).toBe("unsupported");
    expect(evaluate({ ...sample, actualWidth: undefined, actualHeight: undefined }).tiers.map(t => t.tier)).not.toContain("2K");
    const belowLimit = { ...sample, actualWidth: 1440, actualHeight: 810 };
    expect(evaluate(belowLimit).tiers.find(t => t.tier === "2K")?.status).toBe("assumed");
    expect(evaluate(belowLimit, { ...bound, metadata: { ...bound.metadata, imageUnsupportedResolutions: ["2K"] } }).tiers.map(t => t.tier)).not.toContain("2K");
  });
  it("retains every request tier and all ratios through supplier capability merging without marking unverified 4K as passed", () => {
    const bound = bindScannedModelProtocols(connection, [{ ...model, id: "gpt-image-2.5-yf" }]).models[0]!;
    const result = effectiveImageCapabilities({
      supplier: { id: "cx", name: "创想AI", supplierKey: "custom", apiUrl: connection.config.baseUrl, siteUrl: connection.config.baseUrl, kind: "newapi", catalog: { groups: [{ id: "生图", label: "生图", models: [] }] }, scanStatus: "live", createdAt: "now", updatedAt: "now" },
      connection: { ...connection, id: "cx-image" }, model: bound, fingerprint: "fixture",
    });
    expect(result.tiers.map(t => t.tier)).toEqual(["1K", "2K", "4K"]);
    expect(result.tiers.find(t => t.tier === "4K")?.status).toBe("assumed");
    const options = result.model.parameters!.find(p => p.key === "size")!.options!;
    expect(options.some(o => o.value === "auto")).toBe(true);
    for (const tier of ["1K", "2K", "4K"]) expect(options.filter(o => o.label.startsWith(tier))).toHaveLength(11);
    expect(result.model.pricing?.unitAmount).toBe(0.08);
  });
  it("updates cached model controls without overwriting saved node values", () => {
    const result = bindScannedModelProtocols(connection, [model]).models[0]!;
    expect(
      resolutionTierShortcuts(
        result.parameters!.find((p) => p.key === "size")!,
      ).map((t) => t.label),
    ).toEqual(["1K", "2K", "4K"]);
    expect(
      result
        .parameters!.find((p) => p.key === "quality")!
        .options!.map((o) => o.value),
    ).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(result.parameters!.find((p) => p.key === "quality")!.default).toBe(
      "max",
    );
    expect(
      parametersWithDefaults(result.parameters!, {
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
    ).toContain("4K");
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
