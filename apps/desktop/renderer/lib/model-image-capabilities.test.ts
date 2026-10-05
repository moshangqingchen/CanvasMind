import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ImageEditingConnection } from "@super-canvas/providers/image-editing-capabilities";
import { VERIFIED_TRANSPARENT_IMAGES } from "../../../../packages/providers/src/transparent-image-evidence";
import { modelImageCapabilities } from "./model-image-capabilities";

const none = { transparent: false, mask: null };
const descriptor = (id = "gpt-image-2", overrides: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
  id, name: id, operations: ["image.generate", "image.edit"], ...overrides,
});
function connection(host: string, group: string, model: ModelDescriptor, overrides: Record<string, unknown> = {}, provider = "openai"): ImageEditingConnection {
  return { provider, config: { baseUrl: `https://${host}/v1`, modelGroup: group, accountKeyGroup: group, usage: "canvas",
    modelScanStatus: "live", scannedModelIds: [model.id], modelCatalogModels: [model], ...overrides } };
}

describe("model image capability labels", () => {
  it.each(VERIFIED_TRANSPARENT_IMAGES)("retains verified transparency for $hostname / $group / $model without claiming a mask", evidence => {
    const model = descriptor(evidence.model);
    const source = connection(evidence.hostname, evidence.group, model, {}, evidence.provider);
    expect(modelImageCapabilities(source, model)).toEqual({ transparent: true, mask: null });
  });

  it("does not confuse reference-image editing with a mask contract", () => {
    const model = descriptor("gpt-image-2.5-sunburst", { metadata: { supportsImageEdit: true } });
    const source = connection("synoralink.com", "高质量生图专线", model);
    expect(modelImageCapabilities(source, model)).toEqual({ transparent: true, mask: null });
    expect(modelImageCapabilities(connection("unverified.example", "default", model), model)).toEqual(none);
  });

  it.each([
    ["api.frimodel.com", "gpt_image", "gpt-image-2", "openai", "multipart"],
    ["vapi.chuangxiangai.asia", "生图", "gpt-image-2.5-flare-4k", "openai", "url"],
    ["ai.cangyuansuanli.cn", "IMAGE", "gpt-image-2-4k", "rest", "url"],
    ["api.tk1688.com", "default", "gpt-image-1", "openai", "multipart"],
  ])("recognizes the exact mask route for %s / %s / %s", (host, group, id, provider, mask) => {
    const model = descriptor(id);
    expect(modelImageCapabilities(connection(host, group, model, {}, provider), model)).toEqual({ transparent: false, mask });
  });

  it("requires both an edit operation and no explicit edit prohibition for a known mask route", () => {
    const model = descriptor();
    const source = connection("api.frimodel.com", "gpt_image", model);
    expect(modelImageCapabilities(source, descriptor(model.id, { operations: ["image.generate"] })).mask).toBeNull();
    expect(modelImageCapabilities(source, descriptor(model.id, { metadata: { supportsImageEdit: false } })).mask).toBeNull();
    const denied = descriptor(model.id, { metadata: { supportsImageEdit: false } });
    expect(modelImageCapabilities(connection("api.frimodel.com", "gpt_image", denied), model).mask).toBeNull();
  });

  it("uses each candidate's own default tier and lets selected values override it without mutations", () => {
    const model = descriptor("gpt-image-2-x", { parameters: [{ key: "tier", label: "档位", control: "select", default: "4k" }] });
    const source = connection("ai.cangyuansuanli.cn", "IMAGE", model, {}, "rest");
    const selected = Object.freeze({ tier: "web" });
    expect(modelImageCapabilities(source, model).mask).toBe("url");
    expect(modelImageCapabilities(source, model, selected).mask).toBeNull();
    expect(modelImageCapabilities(source, model, { tier: "2k" }).mask).toBe("url");
    expect(modelImageCapabilities(source, descriptor(model.id)).mask).toBeNull();
    expect(model.parameters?.[0]?.default).toBe("4k");
    expect(selected).toEqual({ tier: "web" });
  });

  it.each([
    { usage: "agent" }, { usage: "disabled" }, { supplierArchived: true },
    { accountKeyGroup: "other" }, { modelGroup: "other" },
    { modelScanStatus: "empty" }, { modelScanStatus: "unauthorized" },
    { scannedModelIds: [] }, { scannedModelIds: ["unrelated"] }, { modelCatalogModels: [] },
    { modelCatalogModels: [descriptor("unrelated")] },
    { modelCatalogModels: [descriptor("gpt-image-2", { metadata: { canvasRunnable: false } })] },
    { modelCatalogModels: [descriptor("gpt-image-2", { metadata: { autoInterfaceStatus: "incomplete" } })] },
  ])("does not label a revoked, mismatched, or unavailable connection: %o", change => {
    const model = descriptor();
    // Secure Skill provides a transparency declaration, Fri a mask contract.
    for (const host of ["token.secure-skill.com", "api.frimodel.com"])
      expect(modelImageCapabilities(connection(host, "default", model, change), model)).toEqual(none);
  });

  it.each([
    { operations: [] }, { operations: ["video.generate"] },
    { metadata: { canvasRunnable: false } }, { metadata: { autoInterfaceStatus: "incomplete" } },
  ] satisfies Partial<ModelDescriptor>[]) ("honors a candidate's latest unavailable metadata: %o", change => {
    const model = descriptor();
    const source = connection("api.frimodel.com", "gpt_image", model);
    expect(modelImageCapabilities(source, descriptor(model.id, change))).toEqual(none);
  });

  it("checks the API origin and complete model instead of a supplier's display identity", () => {
    const model = descriptor("gpt-image-2.5-sunburst");
    for (const baseUrl of ["http://synoralink.com/v1", "https://synoralink.com.example/v1", "https://synoralink.com/custom"])
      expect(modelImageCapabilities(connection("synoralink.com", "高质量生图专线", model, { supplierKey: "synora", baseUrl }), model)).toEqual(none);
    const alias = descriptor(`${model.id}-max`);
    expect(modelImageCapabilities(connection("synoralink.com", "高质量生图专线", alias), alias)).toEqual(none);
    expect(modelImageCapabilities(null, model)).toEqual(none);
    expect(modelImageCapabilities(undefined, model)).toEqual(none);
  });

  it("hides temporary scan placeholders until the current Key has a retained matching inventory", () => {
    const model = descriptor("gpt-image-2.5-flare", { metadata: { pendingLiveScan: true } });
    const source = { provider: "openai", config: { baseUrl: "https://tu.988236.xyz/v1", modelGroup: "image2.5全参" } };
    expect(modelImageCapabilities(source, model)).toEqual(none);
    expect(modelImageCapabilities({ ...source, config: { ...source.config, modelScanStatus: "live" } }, model)).toEqual(none);
    for (const modelScanStatus of ["live", "failed"])
      expect(modelImageCapabilities(connection("tu.988236.xyz", "image2.5全参", model, { modelScanStatus }), model).transparent).toBe(true);
  });

  it("retains valid cached capabilities after a transient refresh failure, while respecting known empty inventories", () => {
    const model = descriptor("gpt-image-2.5-sunburst");
    const source = connection("synoralink.com", "高质量生图专线", model, {
      modelScanStatus: "failed", modelScanAttemptStatus: "failed", modelScanLastSuccessAt: "2026-10-05T00:00:00Z",
    });
    expect(modelImageCapabilities(source, model).transparent).toBe(true);
    expect(modelImageCapabilities({ ...source, config: { ...source.config, modelScanStatus: "empty" } }, model)).toEqual(none);
  });
});
