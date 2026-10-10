import { describe, expect, it } from "vitest";
import { cangyuanCurrentModel, type ModelDescriptor } from "@super-canvas/providers";
import { applyBananaImageCapabilities } from "@super-canvas/providers/banana-image-contract";
import { weAIModelDescriptors, WEAI_GEMINI_MODEL_GROUP } from "@super-canvas/providers/weai-models";
import { cyberAfeiCatalogFromPricing } from "./cyberafei-catalog";
import { mikotoGroup, MIKOTO_BANANA_PRO_GROUP } from "./mikoto-presets";
import { normalizedParametersForModel, parameterDescriptorsForValues } from "./model-parameters";
import { declaredImageOutputDimensions, imageResolutionOptionLabel, nativeImageResolutionControl } from "./native-image-resolution";
import { CANGYUAN_BACKUP_IMAGE_CONNECTOR, CANGYUAN_BANANA_PRO_4K_MODEL } from "./provider-presets";

const seed = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate"], metadata: { canvasRunnable: true } });
const adapterCases = [
  { supplier: "GenImage", baseUrl: "https://genimage.pro/v1", group: "geminiResponseUrl", id: "gemini-3-pro-image-preview", values: ["1K", "2K", "4K"] },
  { supplier: "Frimodel", baseUrl: "https://api.frimodel.com/v1", group: "gemini_image", id: "gemini-3-pro-image", values: ["1K", "2K", "4K"] },
  { supplier: "PDog", baseUrl: "https://ai.whyshy.cn", group: "【生图】🍌香蕉nano-banana（稳定渠道）", id: "gemini-3.1-flash-image-preview", values: ["1K", "2K", "4K"] },
  { supplier: "Secure Skill", baseUrl: "https://token.secure-skill.com/v1", group: "banana-全系列", id: "nano-banana-pro", values: ["1K", "2K", "4K"] },
  { supplier: "Secure Skill Lite", baseUrl: "https://token.secure-skill.com/v1", group: "banana-全系列", id: "nano-banana-2-lite", values: ["1K"] },
  { supplier: "We-AI Adobe", baseUrl: "https://asian-acc.we-token.cc/v1", group: "adobe香蕉", id: "gemini-3-pro-image", values: ["1K", "2K", "4K"] },
  { supplier: "Chentu Nano 2.1", baseUrl: "https://tu.988236.xyz/v1", group: "banana", id: "gemini-nano-banana-2.1", values: ["1K", "2K", "4K", "auto"] },
];

function controlFor(model: ModelDescriptor, parameters: Record<string, unknown>) {
  return nativeImageResolutionControl(parameterDescriptorsForValues("image-generation", "rest", model, parameters), model);
}

describe("native image layout across actual Banana supplier contracts", () => {
  it.each(adapterCases)("$supplier keeps its documented image_size tiers and ratios", fixture => {
    const model = applyBananaImageCapabilities({ provider: "openai", config: {
      baseUrl: fixture.baseUrl, modelGroup: fixture.group, accountKeyGroup: fixture.group, usage: "canvas",
    } }, seed(fixture.id));
    const before = structuredClone(model);
    const parameters = { image_size: fixture.values[0], aspect_ratio: "9:16" };
    const control = controlFor(model, parameters);
    expect(control?.resolution.key).toBe("image_size");
    expect(control?.ratio?.key).toBe("aspect_ratio");
    expect(control?.resolution.options?.map(option => option.value)).toEqual(fixture.values);
    expect(control?.resolution.options?.map(imageResolutionOptionLabel)).toEqual(fixture.values.map(value => value === "auto" ? "自动" : value));
    expect(control?.ratio?.options?.some(option => option.value === "9:16")).toBe(true);
    expect(normalizedParametersForModel("image-generation", "rest", model, parameters)).toEqual(parameters);
    expect(declaredImageOutputDimensions(model, "4K", "9:16")).toBeUndefined();
    expect(model).toEqual(before);
  });

  it("We-AI compatible size K enums keep their aspect ratio without becoming WxH", () => {
    const model = weAIModelDescriptors("gemini-3-pro-image", true, WEAI_GEMINI_MODEL_GROUP, "gemini-openai-compatible")[0]!;
    const parameters = { size: "2K", aspect_ratio: "9:16" };
    const control = controlFor(model, parameters);
    expect(control?.resolution.key).toBe("size");
    expect(control?.resolution.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(control?.ratio?.key).toBe("aspect_ratio");
    expect(normalizedParametersForModel("image-generation", "rest", model, parameters)).toEqual(parameters);
    expect(declaredImageOutputDimensions(model, "2K", "9:16")).toBeUndefined();
  });

  it("Cangyuan Nano 2.1 quality is a lowercase native resolution enum", () => {
    const model = cangyuanCurrentModel(seed("gemini-nano-banana-2.1"));
    const parameters = { quality: "2k", aspect_ratio: "9:16" };
    const control = controlFor(model, parameters);
    expect(control?.resolution.key).toBe("quality");
    expect(control?.resolution.options?.map(option => option.value)).toEqual(["1k", "2k", "4k", "auto"]);
    expect(control?.resolution.options?.map(imageResolutionOptionLabel)).toEqual(["1K", "2K", "4K", "自动"]);
    expect(normalizedParametersForModel("image-generation", "rest", model, parameters)).toEqual(parameters);
    expect(declaredImageOutputDimensions(model, "2k", "9:16")).toBeUndefined();
  });

  it("legacy Cangyuan Banana quality aliases retain low/medium/high as the wire values", () => {
    const model = CANGYUAN_BACKUP_IMAGE_CONNECTOR.models!.find(item => item.id === CANGYUAN_BANANA_PRO_4K_MODEL)!;
    const parameters = { quality: "medium", aspect_ratio: "9:16" };
    const control = controlFor(model, parameters);
    expect(control?.resolution.key).toBe("quality");
    expect(control?.resolution.options?.map(option => option.value)).toEqual(["auto", "low", "medium", "high"]);
    expect(control?.resolution.options?.map(imageResolutionOptionLabel)).toEqual(["自动", "1K", "2K", "4K"]);
    expect(normalizedParametersForModel("image-generation", "rest", model, parameters)).toEqual(parameters);
    expect(declaredImageOutputDimensions(model, "medium", "9:16")).toBeUndefined();
  });

  it("Mikoto Banana Pro 1K/2K does not gain an unsupported 4K tier or quality control", () => {
    const model = mikotoGroup(MIKOTO_BANANA_PRO_GROUP)!.models[0]!;
    const parameters = { image_size: "2K", aspect_ratio: "9:16" };
    const control = controlFor(model, parameters);
    expect(control?.resolution.options?.map(option => option.value)).toEqual(["1K", "2K"]);
    expect(model.parameters?.some(parameter => parameter.key === "quality")).toBe(false);
    expect(normalizedParametersForModel("image-generation", "rest", model, parameters)).toEqual(parameters);
    expect(declaredImageOutputDimensions(model, "2K", "9:16")).toBeUndefined();
  });

  it("CyberAfei keeps imageSize/aspectRatio aliases and does not infer pixels from option text", () => {
    const catalog = cyberAfeiCatalogFromPricing({ data: [{ model_name: "gemini-3.1-flash-image-preview", quota_type: 1,
      model_price: 0.08, enable_groups: ["图片视频模型综合分组"], supported_endpoint_types: ["gemini"] }] });
    const model = catalog.groups["图片视频模型综合分组"]![0]!;
    const parameters = { imageSize: "2K", aspectRatio: "9:16" };
    const control = controlFor(model, parameters);
    expect(control?.resolution.key).toBe("imageSize");
    expect(control?.ratio?.key).toBe("aspectRatio");
    expect(control?.resolution.options?.map(option => option.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(control?.ratio?.options?.find(option => option.value === "16:9")?.label).toContain("2752×1536");
    expect(normalizedParametersForModel("image-generation", "rest", model, parameters)).toEqual(parameters);
    expect(declaredImageOutputDimensions(model, "2K", "16:9")).toBeUndefined();
  });
});
