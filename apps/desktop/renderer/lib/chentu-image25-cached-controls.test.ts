import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets, resolveUserImageSizeParameters } from "@super-canvas/providers/image-size-presets";
import { supplierImageMenuContract } from "./supplier-image-menu-contract";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import type { SupplierRecord } from "@super-canvas/db";

const cases = [
  ["image2.5全参", "gpt-image-2.5-flare"], ["image2.5全参", "gpt-image-2.5-sunburst"],
  ["新渠道image2.5全参", "gpt-image-2.5-flare"], ["新渠道image2.5全参", "gpt-image-2.5-sunburst"],
  ["1k福利生图", "gpt-image-2.5"],
  ["image超分", "gpt-image-2"],
] as const;
const raw = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate", "image.edit"],
  metadata: { modelFactsSource: "model-api", priceLabel: "$0.03/张", canvasRunnable: true } });
const connection = (group: string, id: string) => ({ id: "chentu-fixture", provider: "openai", config: {
  baseUrl: "https://tu.988236.xyz/v1", supplierKey: "chentu", modelGroup: group, accountKeyGroup: group,
  modelScanStatus: "live", scannedModelIds: [id], usage: "canvas",
} });

describe("retained Chentu Image 2.5 parameter controls", () => {
  it.each(cases)("restores %s / %s through the cached enrichment order", (group, id) => {
    const original = raw(id), before = structuredClone(original), source = connection(group, id);
    const bound = bindScannedModelProtocols(source, [original]).models[0]!;
    const supplier = { id: "supplier-fixture", apiUrl: source.config.baseUrl, siteUrl: "https://tu.988236.xyz", state: {},
      catalog: { groups: [{ id: group, name: group, description: group === "image2.5全参" ? "全参支持max可透明背景" : group }], models: [] } } as unknown as SupplierRecord;
    const projected = applyUserImageSizePresets(effectiveImageCapabilities({ supplier, connection: source, model: bound, fingerprint: "fixture" }).model);
    const size = projected.parameters?.find(parameter => parameter.key === "size");
    const tiers = group === "1k福利生图" ? ["1K"] : ["1K", "2K", "4K"];
    expect(projected.metadata).toMatchObject({ priceLabel: "$0.03/张", imageMenuContract: group === "image超分" ? "chentu-image2-upscaling-open-request" : "chentu-image25-open-request", imageUserSizePresetSource: "user-request", imageUserSizePresetTiers: tiers });
    for (const tier of tiers) expect(size?.options?.filter(option => option.label.startsWith(`${tier} · `))).toHaveLength(11);
    const quality = id === "gpt-image-2" ? "high" : "max";
    expect(projected.parameters?.find(parameter => parameter.key === "quality")?.default).toBe(quality);
    const parameters = resolveUserImageSizeParameters(projected, { size: "auto", size_tier: tiers.at(-1), aspect_ratio: "16:9", quality });
    expect(parameters.size).toBe(group === "1k福利生图" ? "1360x768" : "3840x2160");
    expect(parameters.quality).toBe(quality);
    expect(applyUserImageSizePresets(supplierImageMenuContract(source, projected))).toEqual(projected);
    expect(original).toEqual(before);
  });

  it("does not manufacture controls for a different group, unlisted ID, explicit enum or native parameter", () => {
    const model = raw("gpt-image-2.5-flare"), source = connection("image2.5全参", model.id);
    for (const config of [
      { ...source.config, modelGroup: "other", accountKeyGroup: "other" },
      { ...source.config, scannedModelIds: [] }, { ...source.config, modelScanStatus: "unauthorized" },
      { ...source.config, accountKeyGroup: "other" }, { ...source.config, usage: "agent" },
      { ...source.config, manualProtocol: true },
    ]) expect(supplierImageMenuContract({ ...source, config }, model)).toBe(model);
    const explicit = { ...model, metadata: { ...model.metadata, imageSizeOptionsCompleteEnum: true },
      parameters: [{ key: "size", label: "原生档位", control: "select" as const, options: [{ value: "2K", label: "2K" }] }] };
    expect(supplierImageMenuContract(source, explicit)).toBe(explicit);
  });

  it.each([
    ["低价Adobe生图", "gpt-image-2-1k", "1K"], ["低价Adobe生图", "gpt-image-2-2k", "2K"], ["低价Adobe生图", "gpt-image-2-4k", "4K"],
    ["兜底原生生图", "gpt-image-2-1k", "1K"], ["兜底原生生图", "gpt-image-2-2k", "2K"], ["兜底原生生图", "gpt-image-2-4k", "4K"],
    ["1k低价生图", "gpt-image-2", "1K"], ["1k低价生图", "gpt-image-2-1k", "1K"],
    ["1k福利生图", "gpt-image-2", "1K"], ["1k福利生图", "gpt-image-2-1k", "1K"],
    ["image2.5全参", "gpt-image-2-4k", "4K"],
  ])("restores all user ratios for %s / %s without changing its fixed %s tier", (group, id, tier) => {
    const source = connection(group, id), original = raw(id);
    const projected = applyUserImageSizePresets(bindScannedModelProtocols(source, [original]).models[0]!);
    expect(projected.metadata).toMatchObject({ imageSizeOptionsCompleteEnum: false, imageFixedResolution: tier, imageUserSizePresetTiers: [tier] });
    for (const ratio of ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"])
      expect(projected.parameters?.find(parameter => parameter.key === "size")?.options?.some(option => option.label.startsWith(`${tier} · ${ratio} ·`))).toBe(true);
  });

  it("retains the exact current Key's capability enum", () => {
    const source = connection("az兜底渠道1k生图", "gpt-image-2-1k");
    const original: ModelDescriptor = { ...raw("gpt-image-2-1k"), metadata: { imageSizeCapabilitiesSource: "/v1/image/model-capabilities" },
      parameters: [{ key: "size", label: "Key sizes", control: "select", options: [{ value: "1024x1024", label: "1K · 1:1 · 1024 × 1024" }] }] };
    const projected = applyUserImageSizePresets(supplierImageMenuContract(source, original));
    expect(projected.parameters?.find(parameter => parameter.key === "size")?.options).toEqual(original.parameters?.[0]?.options);
    expect(projected.metadata?.imageSizeOptionsCompleteEnum).toBe(true);
    expect(projected.metadata?.imageUserSizePresets).toBeUndefined();
  });
});
