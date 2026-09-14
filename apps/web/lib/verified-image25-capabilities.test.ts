import { describe, expect, it } from "vitest";
import { applyVerifiedImage25Capabilities } from "./verified-image25-capabilities";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import {
  mikotoConnectionConfig,
  MIKOTO_IMAGE_1K_GROUP,
  MIKOTO_IMAGE_4K_GROUP,
} from "./mikoto-presets";
import {
  cangyuanCatalogFromPricing,
  cangyuanConnectorForModels,
} from "./cangyuan-catalog";
import type { ModelDescriptor } from "@super-canvas/providers";
import { parametersWithDefaults } from "./model-parameters";
import { resolutionTierShortcuts, sizeOnTierChange } from "../components/node-parameter-fields";

const model: ModelDescriptor = {
  id: "gpt-image-2.5-flare",
  name: "Flare",
  operations: ["image.generate"],
};
describe("verified supplier 2.5 capabilities", () => {
  it("does not enable Sunburst xhigh after a timed-out real generation", () => {
    const result = applyVerifiedImage25Capabilities(
      {
        provider: "openai",
        config: {
          supplierKey: "frimodel",
          baseUrl: "https://api.frimodel.com/v1",
          modelGroup: "gpt_image_adobe",
        },
      },
      { ...model, id: "gpt-image-2.5-sunburst-adobe" },
    );
    const values = result.parameters
      ?.find((p) => p.key === "quality")
      ?.options?.map((o) => o.value);
    expect(values).toContain("max");
    expect(values).not.toContain("xhigh");
  });
  it("upgrades an existing cached Mikoto model and its runtime connector together", () => {
    const connection = {
      provider: "rest",
      config: mikotoConnectionConfig(MIKOTO_IMAGE_4K_GROUP),
    };
    const result = bindScannedModelProtocols(connection, [model]);
    const m = result.models[0]!;
    expect(
      m.parameters
        ?.find((p) => p.key === "quality")
        ?.options?.map((o) => o.value),
    ).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(
      m.parameters?.find((p) => p.key === "size")?.options?.map((o) => o.value),
    ).toEqual(
      expect.arrayContaining([
        "auto",
        "1024x1024",
        "2048x2048",
        "3840x2160",
        "2160x3840",
        "2880x2880",
      ]),
    );
    expect(m.parameters?.find((p) => p.key === "size")?.options).toHaveLength(
      34,
    );
    expect(m.operations).toContain("image.edit");
    expect(result.connector?.models).toEqual([m]);
    expect(bindScannedModelProtocols(connection, result.models).models).toEqual(
      result.models,
    );
  });
  it.each([
    {
      supplierKey: "mikoto",
      modelGroup: "unknown-image-group",
      baseUrl: "https://api.mikoto.vip",
    },
    {
      supplierKey: "mikoto",
      modelGroup: MIKOTO_IMAGE_4K_GROUP,
      baseUrl: "https://other.example",
    },
    {
      supplierKey: "chentu",
      modelGroup: "1k低价生图",
      baseUrl: "https://tu.988236.xyz/v1",
    },
  ])(
    "leaves an unverified group/host unchanged: $modelGroup $baseUrl",
    (config) => {
      expect(
        applyVerifiedImage25Capabilities({ provider: "rest", config }, model),
      ).toBe(model);
    },
  );
  it("repairs cached Mikoto Flare 1K ratios without adding higher tiers or qualities", () => {
    const connection = {
      provider: "rest",
      config: mikotoConnectionConfig(MIKOTO_IMAGE_1K_GROUP),
    };
    const initial = bindScannedModelProtocols(connection, [model]);
    const repaired = bindScannedModelProtocols(
      { ...connection, config: { ...connection.config, connector: initial.connector } },
      initial.models,
    );
    const descriptor = repaired.models[0]!;
    const size = descriptor.parameters?.find(p => p.key === "size");
    expect(size?.options).toHaveLength(12);
    expect(size?.options?.filter(o => o.value !== "auto").every(o => o.label.startsWith("1K"))).toBe(true);
    expect(size?.options?.map(o => o.value)).toEqual(expect.arrayContaining([
      "auto", "1360x768", "768x1360", "1552x672", "672x1552",
    ]));
    expect(descriptor.parameters?.find(p => p.key === "quality")).toMatchObject({
      default: "high",
      options: [{ label: "自动", value: "auto" }, { label: "高", value: "high" }],
    });
    expect(repaired.connector?.models).toEqual(repaired.models);
    expect(repaired.models).toEqual(initial.models);
    expect(applyVerifiedImage25Capabilities(connection, {
      ...model, id: "gpt-image-2.5-sunburst",
    }).parameters).toBeUndefined();
    const denied = { ...descriptor, metadata: { canvasRunnable: false, canvasUnavailableReason: "403 权限拒绝" } };
    expect(applyVerifiedImage25Capabilities(connection, denied)).toBe(denied);
  });
  it("does not turn a key denial into a runnable model", () => {
    const denied = {
      ...model,
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "403 权限拒绝",
      },
    };
    expect(
      applyVerifiedImage25Capabilities(
        {
          provider: "rest",
          config: mikotoConnectionConfig(MIKOTO_IMAGE_4K_GROUP),
        },
        denied,
      ),
    ).toBe(denied);
  });
  it.each(["flare", "sunburst"])(
    "keeps Chentu Adobe %s tiers scoped to its own generation evidence",
    (variant) => {
      const result = applyVerifiedImage25Capabilities(
        {
          provider: "openai",
          config: {
            supplierKey: "chentu",
            modelGroup: "低价Adobe生图",
            baseUrl: "https://tu.988236.xyz/v1",
          },
        },
        { ...model, id: `gpt-image-2.5-${variant}` },
      );
      const sizes =
        result.parameters?.find((p) => p.key === "size")?.options ?? [];
      expect(sizes).toHaveLength(variant === "flare" ? 34 : 23);
      expect(sizes.some((o) => o.value === "3840x2160")).toBe(true);
      expect(sizes.some((o) => o.label.startsWith("2K"))).toBe(variant === "flare");
      expect(
        result.parameters
          ?.find((p) => p.key === "quality")
          ?.options?.map((o) => o.value),
      ).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    },
  );
  it("refreshes cached Chentu Flare 2K controls and runtime parameters together", () => {
    const connection = {
      provider: "openai",
      config: { supplierKey: "chentu", modelGroup: "低价Adobe生图", baseUrl: "https://tu.988236.xyz/v1" },
    };
    const cached = applyVerifiedImage25Capabilities(connection, model);
    cached.parameters = cached.parameters?.map(p => p.key === "size"
      ? { ...p, options: p.options?.filter(o => !o.label.startsWith("2K")) }
      : p);
    const bound = bindScannedModelProtocols(connection, [cached]);
    const updated = bound.models[0]!;
    const size = updated.parameters!.find(p => p.key === "size")!;
    const twoK = size.options!.filter(o => o.label.startsWith("2K"));
    expect(twoK).toHaveLength(11);
    expect(twoK.every(o => o.label.includes("实际可能近似"))).toBe(true);
    expect(resolutionTierShortcuts(size).map(t => t.label)).toEqual(["1K", "2K", "4K"]);
    expect(sizeOnTierChange(size, "3840x2160", "2K")).toBe("2720x1536");
    expect(sizeOnTierChange(size, "2160x3840", "2K")).toBe("1536x2720");
    expect(parametersWithDefaults(updated.parameters!, { size: "auto", size_tier: "2K" })).toMatchObject({
      size: "auto", size_tier: "2K", quality: "max",
    });
    // OpenAI adapters consume the model parameters directly, without a REST connector.
    expect(bound.connector).toBeUndefined();
    expect(updated.metadata).toMatchObject({ image2KVerifiedAt: "2026-09-14", image2KAllowsApproximateOutput: true });
    expect(bindScannedModelProtocols(connection, bound.models).models).toEqual(bound.models);
  });
  it("offers only exact 1K/2K on Cyber Afei, without adding ignored quality values", () => {
    const m = applyVerifiedImage25Capabilities(
      {
        provider: "rest",
        config: {
          supplierKey: "cyberafei",
          baseUrl: "https://api.3365api.cn",
          modelGroup: "image-2稳定生图",
        },
      },
      { ...model, id: "gpt-image-2.5" },
    );
    expect(m.parameters?.find((p) => p.key === "size")?.options).toHaveLength(
      23,
    );
    expect(m.parameters?.find((p) => p.key === "quality")).toBeUndefined();
  });
  it.each(["1k", "2k", "4k"])(
    "keeps Cangyuan %s as a separate SKU and forwards quality/reference inputs",
    (tier) => {
      const id = `gpt-image-2.5-flare-${tier}`;
      const catalog = cangyuanCatalogFromPricing({
        data: [
          {
            model_name: id,
            request_unit: "image",
            enable_groups: ["IMAGE"],
            image_ui_params: {
              referenceLimits: { images: 9 },
              params: {
                customDimensions: { enabled: true },
                quality: {
                  enabled: true,
                  options: ["medium", "low", "high", "xhigh", "max"].map(
                    (value) => ({ label: value, value }),
                  ),
                },
              },
            },
          },
        ],
      });
      const models = catalog.groups.IMAGE!;
      const m = models.find((m) => m.id === id)!;
      const cached = applyVerifiedImage25Capabilities(
        {
          provider: "rest",
          config: {
            supplierKey: "cangyuan",
            baseUrl: "https://ai.cangyuansuanli.cn",
            modelGroup: "IMAGE",
          },
        },
        {
          ...m,
          parameters: m.parameters?.map((p) =>
            p.key === "size"
              ? {
                  ...p,
                  options: [
                    {
                      label: `${tier.toUpperCase()} · 1:1`,
                      value: "1024x1024",
                    },
                  ],
                }
              : p,
          ),
        },
      );
      expect(
        cached.parameters?.find((p) => p.key === "size")?.options,
      ).toHaveLength(12);
      expect(m.parameters?.find((p) => p.key === "size")?.options).toHaveLength(
        12,
      );
      expect(m.operations).toContain("image.edit");
      expect(m.parameters?.find((p) => p.key === "quality")).toMatchObject({
        label: "质量",
        default: "medium",
      });
      expect(
        m.parameters
          ?.find((p) => p.key === "size")
          ?.options?.every(
            (o) => o.value === "auto" || o.label.startsWith(tier.toUpperCase()),
          ),
      ).toBe(true);
      const override = cangyuanConnectorForModels("IMAGE", [m])
        .modelOverrides?.[id];
      expect(override?.submit?.mappings).toContainEqual(
        expect.objectContaining({ target: "/quality" }),
      );
      expect(
        override?.operationOverrides?.["image.edit"]?.submit?.mappings,
      ).toContainEqual(expect.objectContaining({ target: "/images" }));
    },
  );
});
