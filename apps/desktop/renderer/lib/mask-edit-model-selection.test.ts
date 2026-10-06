import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { getImageEditingCapabilities } from "@super-canvas/providers/image-editing-capabilities";
import type { ProviderConnectionView } from "./client-api";
import { selectMaskEditModel, type MaskEditModelCandidate } from "./mask-edit-model-selection";

const model = (id: string, overrides: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
  id, name: id, operations: ["image.generate", "image.edit"],
  parameters: [{ key: "quality", label: "质量", control: "select", default: "low",
    options: ["low", "high", "max"].map(value => ({ value, label: value })) }], ...overrides,
});

function source(models: ModelDescriptor[], overrides: Partial<ProviderConnectionView> = {}): ProviderConnectionView {
  return { id: "cangyuan", name: "沧元", provider: "rest", apiKeySet: true, apiKeyUsable: true, apiKey: "",
    config: { baseUrl: "https://ai.cangyuansuanli.cn/", usage: "canvas", modelGroup: "IMAGE", accountKeyGroup: "IMAGE",
      modelScanStatus: "live", scannedModelIds: models.map(item => item.id), modelCatalogModels: models }, ...overrides };
}

const options = (connection: ProviderConnectionView, models: ModelDescriptor[]): MaskEditModelCandidate[] =>
  models.map(model => ({ connection, model }));

describe("mask edit model selection", () => {
  it("selects available 4K at the highest declared quality instead of the catalog's first 1K model", () => {
    const models = ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k"].map(id => model(id));
    const connection = source(models);
    const choice = selectMaskEditModel(options(connection, models));
    expect(choice?.model.id).toBe("gpt-image-2-4k");
    expect(choice?.parameters.quality).toBe("max");
    expect(choice?.capabilities.mask).toBe("url");
    expect(models[2]?.parameters?.[0]?.default).toBe("low");
  });

  it("preserves an explicit source model without upgrading its price or resolution", () => {
    const models = [model("gpt-image-2-1k"), model("gpt-image-2-4k")];
    const origin = source(models, { id: "origin" });
    const otherModel = model("gpt-image-2.5-flare-4k");
    const other = source([otherModel], { id: "other", provider: "openai", config: {
      baseUrl: "https://vapi.chuangxiangai.asia/v1", modelGroup: "生图", accountKeyGroup: "生图",
    } });
    const choices = [...options(other, [otherModel]), ...options(origin, models)];
    expect(selectMaskEditModel(choices, { connectionId: origin.id, modelId: models[0]!.id })?.model.id).toBe("gpt-image-2-1k");
    expect(selectMaskEditModel(choices, { connectionId: origin.id })?.connection.id).toBe(origin.id);
  });

  it("keeps a valid source model family ahead of unrelated models in the same connection", () => {
    const models = [model("gpt-image-2-4k"), model("gpt-image-2.5-flare")];
    const connection = source(models);
    expect(selectMaskEditModel(options(connection, models), { connectionId: connection.id, modelId: "gpt-image-2.5-flare" })?.model.id)
      .toBe("gpt-image-2.5-flare");
  });

  it("ignores stale revoked source models even though their static route supports a mask", () => {
    const stale = model("gpt-image-2-1k");
    const available = model("gpt-image-2-4k");
    const connection = source([available]);
    expect(getImageEditingCapabilities(connection, stale.id).mask).toBe("url");
    const choice = selectMaskEditModel(options(connection, [stale, available]), { connectionId: connection.id, modelId: stale.id });
    expect(choice?.model.id).toBe(available.id);
  });

  it.each([
    { modelScanStatus: "unauthorized" }, { modelScanStatus: "empty" },
    { accountKeyGroup: "another-group" }, { scannedModelIds: [] }, { modelCatalogModels: [] },
    { supplierArchived: true }, { usage: "agent" }, { usage: "disabled" },
  ])("does not select an unusable connection: %o", change => {
    const selected = model("gpt-image-2-4k");
    const connection = source([selected]);
    connection.config = { ...connection.config, ...change };
    expect(selectMaskEditModel(options(connection, [selected]), { connectionId: connection.id })).toBeNull();
  });

  it.each([
    { operations: ["image.generate"] }, { metadata: { supportsImageEdit: false } },
    { metadata: { canvasRunnable: false } }, { metadata: { autoInterfaceStatus: "incomplete" } },
  ] satisfies Partial<ModelDescriptor>[]) ("rejects unusable model metadata: %o", change => {
    const selected = model("gpt-image-2-4k", change);
    expect(selectMaskEditModel(options(source([selected]), [selected]))).toBeNull();
  });

  it("never falls back to an ordinary reference editor or a fake connection", () => {
    const reference = model("gpt-image-2.5-sunburst");
    const connection = source([reference], { provider: "openai", config: {
      baseUrl: "https://synoralink.com/v1", modelGroup: "高质量生图专线", usage: "canvas",
    } });
    expect(selectMaskEditModel(options(connection, [reference]))).toBeNull();
    const fake = source([model("fake-image-v1")], { provider: "fake" });
    expect(selectMaskEditModel(options(fake, [model("fake-image-v1")]))).toBeNull();
    expect(selectMaskEditModel([])).toBeNull();
  });

  it("falls back to another usable mask connection when the source has no mask support", () => {
    const reference = model("gpt-image-2.5-sunburst");
    const origin = source([reference], { id: "synora", provider: "openai", config: {
      baseUrl: "https://synoralink.com/v1", modelGroup: "高质量生图专线",
    } });
    const editable = model("gpt-image-2");
    const fri = source([editable], { id: "fri", provider: "openai", config: {
      baseUrl: "https://api.frimodel.com/v1", modelGroup: "gpt_image",
    } });
    const choice = selectMaskEditModel([...options(origin, [reference]), ...options(fri, [editable])], { connectionId: origin.id });
    expect(choice?.connection.id).toBe("fri");
    expect(choice?.capabilities.mask).toBe("multipart");
  });

  it("chooses the highest declared native tier and never injects an undeclared 4K tier", () => {
    for (const values of [["web", "1k", "2k", "4k"], ["web", "1k", "2k"]]) {
      const selected = model("gpt-image-2-x", { parameters: [
        { key: "tier", label: "档位", control: "select", default: "web", options: values.map(value => ({ value, label: value })) },
      ] });
      expect(selectMaskEditModel(options(source([selected]), [selected]))?.parameters.tier).toBe(values.at(-1));
    }
    const selected = model("gpt-image-2-x", { parameters: [{ key: "tier", label: "档位", control: "select", default: "web" }] });
    expect(selectMaskEditModel(options(source([selected]), [selected]))).toBeNull();
  });

  it("honors source resolution and quality limits without inventing unsupported max", () => {
    const selected = model("gpt-image-2-2k", { parameters: [
      { key: "quality", label: "质量", control: "select", default: "low", options: ["low", "high"].map(value => ({ value, label: value })) },
    ] });
    const choice = selectMaskEditModel(options(source([selected]), [selected]));
    expect(choice?.model.id).toBe("gpt-image-2-2k");
    expect(choice?.parameters.quality).toBe("high");
  });

  it("retains the source model's explicit quality, size and mask-capable tier", () => {
    const selected = model("gpt-image-2-x");
    selected.parameters = [...selected.parameters!,
      { key: "tier", label: "档位", control: "select", default: "4k", options: ["web", "1k", "2k", "4k"].map(value => ({ value, label: value })) },
      { key: "size", label: "尺寸", control: "text", default: "auto" },
    ];
    const connection = source([selected]);
    const parameters = Object.freeze({ tier: "1k", quality: "low", size: "1024x1024", mask: "old-mask", maskAssetId: "old-asset" });
    const choice = selectMaskEditModel(options(connection, [selected]), { connectionId: connection.id, modelId: selected.id, parameters });
    expect(choice?.parameters).toMatchObject({ tier: "1k", quality: "low", size: "1024x1024" });
    expect(choice?.parameters).not.toHaveProperty("mask");
    expect(choice?.parameters).not.toHaveProperty("maskAssetId");
    const fromWeb = selectMaskEditModel(options(connection, [selected]), { connectionId: connection.id, modelId: selected.id,
      parameters: { tier: "web", quality: "low", size: "auto" } });
    expect(fromWeb?.parameters).toMatchObject({ tier: "4k", quality: "low", size: "auto" });
  });

  it("does not switch to another supplier merely because it has a higher resolution", () => {
    const oneK = model("gpt-image-2-1k");
    const fourK = model("gpt-image-2-4k");
    const first = source([oneK], { id: "first" });
    const later = source([fourK], { id: "later" });
    expect(selectMaskEditModel([...options(first, [oneK]), ...options(later, [fourK])])?.connection.id).toBe("first");
  });

  it("accepts valid retained scan data after a refresh failure but rejects a missing or unusable key", () => {
    const selected = model("gpt-image-2-4k");
    const connection = source([selected]);
    connection.config.modelScanStatus = "failed";
    expect(selectMaskEditModel(options(connection, [selected]))?.model.id).toBe(selected.id);
    expect(selectMaskEditModel(options({ ...connection, apiKeyUsable: false }, [selected]))).toBeNull();
    expect(selectMaskEditModel(options({ ...connection, apiKeyUsable: undefined, apiKeySet: false }, [selected]))).toBeNull();
  });

  it("does not mutate the supplied candidate order, connection, or model defaults", () => {
    const models = [model("gpt-image-2-1k"), model("gpt-image-2-4k")];
    const connection = source(models);
    const candidates = Object.freeze(options(connection, models));
    const before = structuredClone(candidates);
    selectMaskEditModel(candidates, { connectionId: connection.id });
    expect(candidates).toEqual(before);
  });
});
