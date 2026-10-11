import { describe, expect, it } from "vitest";
import type { SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { parseTk1688Marketplace } from "@super-canvas/providers";
import { effectiveImageCapabilities, verificationParameters } from "./supplier-capabilities";
import { normalizedParametersForModel, parameterDescriptorsFor } from "./model-parameters";

function capabilities(id: string, apiUrl = "https://api.tk1688.com/v1", extra: Partial<ModelDescriptor> = {}) {
  const supplier: SupplierRecord = {
    id: "tk1688", name: "词元", supplierKey: "tk1688", apiUrl, siteUrl: "https://tk1688.com",
    kind: "newapi", scanStatus: "live", createdAt: "now", updatedAt: "now", catalog: { groups: [] },
  };
  const connection = { id: "merchant-key", provider: "openai", config: { baseUrl: apiUrl, modelGroup: "默认群组" } };
  return effectiveImageCapabilities({ supplier, connection, fingerprint: "current-key",
    model: { id, name: id, operations: ["image.generate", "image.edit"], ...extra } });
}

describe("Tk1688 image parameter controls", () => {
  it.each(["tk1688.com", "api.tk1688.com", "ai.tk1688.com"])(
    "retains the merchant ID and existing Image 2 quality controls on %s", host => {
      const id = "gpt-image-2@s12c29";
      const result = capabilities(id, `https://${host}/v1`);
      expect(result.model.id).toBe(id);
      expect(result.quality).toBe("high");
      expect(result.qualityOptions).toEqual(["low", "medium", "high"]);
      const controls = parameterDescriptorsFor("image-generation", "openai", result.model);
      expect(controls.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["low", "medium", "high"]);
      // A bare Key ID has no merchant size declaration. Do not revive the
      // generic provider's pixel table merely from its Image 2 family name.
      expect(controls.some(parameter => parameter.key === "size")).toBe(false);
      expect(result.model.metadata?.qualitySupport).toBe("assumed");
      expect(result.evidence.some(evidence => evidence.status === "verified")).toBe(false);
    },
  );

  it.each(["gpt-image-2.5-sunburst@s1c23", "gpt-image-2.5-flare@s12c29", "gpt-image-2.5-sunburst"])(
    "does not invent max/xhigh quality from the merchant model name %s", id => {
      const result = capabilities(id);
      expect(result.model.id).toBe(id);
      expect(result.quality).toBe("high");
      expect(result.qualityOptions).toEqual(["low", "medium", "high"]);
      const quality = parameterDescriptorsFor("image-generation", "openai", result.model).find(parameter => parameter.key === "quality");
      expect(quality?.default).toBe("high");
      expect(quality?.options?.map(option => option.value)).toEqual(["high"]);
      expect(verificationParameters(result, "4K").parameters.quality).toBe("high");
      expect(result.model.metadata?.qualitySupport).toBe("assumed");
      expect(result.evidence.filter(evidence => evidence.quality).every(evidence => evidence.status === "assumed")).toBe(true);
    },
  );

  it("keeps explicit quality enumerations separate from generic name inference", () => {
    const result = capabilities("gpt-image-2.5-sunburst@s1c23", undefined, {
      parameters: [{ key: "quality", label: "质量", control: "select",
        options: ["auto", "low", "medium", "high"].map(value => ({ value, label: value })) }],
    });
    expect(result.quality).toBe("high");
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high"]);
  });

  it("does not change other suppliers' existing Image 2.5 quality policy", () => {
    const result = capabilities("gpt-image-2.5-sunburst@s1c23", "https://other.example/v1");
    expect(result.quality).toBe("max");
    expect(result.qualityOptions).toContain("max");
    expect(result.qualityOptions).toContain("xhigh");
  });

  it("uses the current connection API origin ahead of the supplier identity", () => {
    const result = capabilities("gpt-image-2@s12c29", "https://other.example/v1");
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["high"]);
  });
});

describe("Tk1688 marketplace controls take precedence over generic presets", () => {
  const entries = [
    { alias: "gpt-image-2.5-sunburst@s47c261", base_model: "gpt-image-2.5-sunburst", status: "active", charge_type: "per_request",
      description: "Adobe支持原生4K(3840*2160)，不支持N。" },
    { alias: "gpt-image-2.5-sunburst@s46c265", base_model: "gpt-image-2.5-sunburst", status: "active", charge_type: "per_request", description: "支持1K/2K。" },
    { alias: "gpt-image-2@s12c29", base_model: "gpt-image-2", status: "active", charge_type: "per_request", description: "通用稳定渠道。" },
  ];
  const models = parseTk1688Marketplace({ success: true, data: { items: entries, total: entries.length } }, undefined, { checkedAt: "market-now" }).models;
  const get = (id: string) => {
    const model = models.find(model => model.id === id)!;
    return capabilities(id, "https://api.tk1688.com/v1", model);
  };

  it("keeps native 4K as supplier evidence while opening pixel inputs and removing batch controls", () => {
    const result = get("gpt-image-2.5-sunburst@s47c261");
    const controls = parameterDescriptorsFor("image-generation", "openai", result.model);
    expect(controls.find(parameter => parameter.key === "size")?.control).toBe("dimensions");
    expect(result.model.metadata?.tk1688FixedSize).toBeUndefined();
    expect(result.model.metadata?.tk1688ReferenceSize).toBe("3840x2160");
    expect(controls.some(parameter => parameter.key === "n")).toBe(false);
    expect(controls.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    const normalized = normalizedParametersForModel("image-generation", "openai", result.model, { n: 2 });
    expect(normalized.size).toBe("auto");
    // Keep a previously saved user value visible; the exact merchant request
    // mapper omits N rather than silently modifying the saved node parameter.
    expect(normalized.n).toBe(2);
    const planned = verificationParameters(result, "4K");
    expect(planned).toMatchObject({ width: 0, height: 0 });
    expect(planned.parameters).not.toHaveProperty("size");
    expect(planned.parameters).not.toHaveProperty("n");
    expect(result.probeTiers).toEqual([]);
    expect(result.evidence).toContainEqual(expect.objectContaining({ resolution: "4K", status: "declared", checkedAt: "market-now" }));
    expect(result.evidence.some(evidence => evidence.status === "verified")).toBe(false);
  });

  it("offers requested tiers while retaining the merchant's original declarations", () => {
    const result = get("gpt-image-2.5-sunburst@s46c265");
    const controls = parameterDescriptorsFor("image-generation", "openai", result.model);
    expect(controls.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(result.model.metadata?.tk1688SupportedResolutions).toEqual(["1K", "2K"]);
    expect(controls.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["auto", "high", "medium", "low"]);
    expect(controls.find(parameter => parameter.key === "n")?.max).toBe(4);
    expect(controls.find(parameter => parameter.key === "response_format")?.options?.map(option => option.value)).toEqual(["url", "b64_json"]);
    expect(result.quality).toBe("high");
    expect(result.probeTiers).toEqual([]);
  });

  it("keeps requested tier controls separate from unknown supplier pixel declarations", () => {
    for (const id of ["gpt-image-2@s12c29", "gpt-image-2.5-sunburst"]) {
      const result = get(id);
      const controls = parameterDescriptorsFor("image-generation", "openai", result.model);
      expect(controls.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
      const size = controls.find(parameter => parameter.key === "size");
      expect(size?.control).toBe("dimensions");
      expect(size?.options?.map(option => option.value)).toEqual(["auto", "1024x1024", "1536x1024", "1024x1536"]);
      expect(size?.options?.some(option => /\b[124]K\b/u.test(option.label))).toBe(false);
      expect(size).not.toHaveProperty("min");
      expect(size).not.toHaveProperty("max");
      expect(size).not.toHaveProperty("step");
      expect(controls.find(parameter => parameter.key === "quality")?.options?.some(option => option.value === "max" || option.value === "xhigh")).toBe(false);
      expect(result.tiers).toEqual([]);
      expect(result.probeTiers).toEqual([]);
      expect(normalizedParametersForModel("image-generation", "openai", result.model,
        { size: "5000x4000", aspect_ratio: "5:4", resolution: "auto", quality: "high" }))
        .toMatchObject({ size: "5000x4000", aspect_ratio: "5:4", resolution: "auto", quality: "high" });
    }
    expect(parameterDescriptorsFor("image-generation", "openai", get("gpt-image-2.5-sunburst").model).some(parameter => parameter.key === "n")).toBe(false);
  });
});
