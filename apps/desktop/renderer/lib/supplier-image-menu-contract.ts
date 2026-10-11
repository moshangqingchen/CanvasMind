import type { ModelDescriptor } from "@super-canvas/providers";
import { applyHangImageCapabilities } from "@super-canvas/providers/hang-image-contract";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";
import { friModelFallbackImageDescriptor } from "./frimodel-presets";
import { applyVerifiedImage25Capabilities } from "./verified-image25-capabilities";
import { cyberAfeiImage2Parameters } from "./cyberafei-catalog";
import { applyWeAIImageDimensionContract } from "@super-canvas/providers/weai-models";
import { applyCOpenImageCapabilities } from "@super-canvas/providers/c-open-image-contract";
import { parseSupplierGroupDetails } from "@super-canvas/providers/supplier-group-details";
import { applyMonsterImageCapabilities } from "@super-canvas/providers/monster-image-capabilities";
import { applySecureSkillImageCapabilities } from "@super-canvas/providers/secure-skill-image-contract";

/** Restore exact supplier controls before generic capability/history enrichment. */
export function supplierImageMenuContract(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (!["openai", "rest", "weai"].includes(connection.provider) || connection.config.manualProtocol === true || model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test" || !model.operations.some(operation => operation.startsWith("image."))) return model;
  const weai = applyWeAIImageDimensionContract(connection, model);
  if (weai !== model) return weai;
  if (connection.provider === "weai") return model;
  const secure = applySecureSkillImageCapabilities(connection, model);
  if (secure !== model) return secure;
  const cOpen = applyCOpenImageCapabilities(connection, model);
  if (cOpen !== model) return cOpen;
  const monster = applyMonsterImageCapabilities(connection, model);
  if (monster !== model) return monster;
  const hang = applyHangImageCapabilities(connection, model);
  if (hang !== model) return hang;
  let host: string;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
        !/^(?:\/v1)?\/?$/u.test(url.pathname)) return model;
    host = url.hostname;
  } catch { return model; }
  if (["api.frimodel.com", "platform.frimodel.com"].includes(host) && connection.provider !== "openai") return model;
  const group = String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "");
  if (host === "tu.988236.xyz" && group === "grok生图" &&
      ["grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-2.0福利"].includes(model.id) && !model.metadata?.imageSizeCapabilitiesSource) {
    // The supplier's API docs require its keyed capability response for exact
    // sizes; that endpoint currently returns 404 for this group. Neither the
    // group label nor the generic image creator supplies a Grok pixel contract.
    // Keep its documented response transport and do not revive GPT controls.
    return { ...model, parameters: [{ key: "size_tier", label: "分辨率档位偏好", control: "select", valueType: "string", default: "auto", options: [{ value: "auto", label: "自动" }, { value: "1K", label: "1K" }, { value: "2K", label: "2K" }], description: "官方分组声明1K/2K；应用档位偏好。当前 keyed /v1/images/models 返回404，提交该偏好需对应请求schema，未造上游resolution字段。" }, { key: "response_format", label: "返回方式", control: "select", default: "url",
      options: [{ value: "url", label: "图片链接" }, { value: "b64_json", label: "Base64" }] }],
      metadata: { ...model.metadata, imageNativeParameterContract: true, imageParameterContract: "keyed-size-schema-unavailable", imageApplicationOnlyResolution: true, imageNativeResolutionParameter: "size_tier", imageResolutionTierParameter: "size_tier",
        imageSupportedResolutions: ["1K", "2K"], imageOutputDimensions: undefined, qualitySupport: "provider-decided",
        imageParameterContractNote: "本分组说明支持 1K / 2K，但当前尺寸能力接口未返回可确认的比例、像素和质量选项。应用档位偏好可保存；请求映射需 keyed schema。已保存的比例/尺寸原值继续保留，提交前提示具体资料条件。",
        documentationUrl: "https://tu.988236.xyz/docs/api-media.zh-CN.md", contractCheckedAt: "2026-10-10T01:38:27.000Z" } };
  }
  const historical = applyVerifiedImage25Capabilities(connection, model);
  if (historical !== model && historical.metadata?.imageSizeContract === "same-full-id-historical-request-samples") return historical;
  const chentuOpenImage = host === "tu.988236.xyz" && connection.provider === "openai" &&
    ((["image2.5全参", "新渠道image2.5全参"].includes(group) && /^gpt-image-2\.5-(?:flare|sunburst)$/u.test(model.id)) ||
      group === "1k福利生图" && model.id === "gpt-image-2.5" || group === "image超分" && model.id === "gpt-image-2") &&
    connection.config.supplierArchived !== true && !["agent", "disabled"].includes(String(connection.config.usage)) &&
    !["empty", "unauthorized"].includes(String(connection.config.modelScanStatus)) &&
    Array.isArray(connection.config.scannedModelIds) && connection.config.scannedModelIds.includes(model.id) &&
    (connection.config.accountKeyGroup === undefined || connection.config.modelGroup === undefined || connection.config.accountKeyGroup === connection.config.modelGroup);
  if (chentuOpenImage) {
    // These saved live Image 2.5 entries use the existing Images size/quality
    // request mapping. An absent old schema must not remove user controls.
    // This is an application request preference, not a supplier pixel table.
    const size = model.parameters?.find(parameter => parameter.key === "size");
    if (model.metadata?.imageSizeOptionsCompleteEnum === true ||
        size?.options?.some(option => /^(?:[124]K|\d+:\d+)$/iu.test(String(option.value)))) return model;
    const parameters = [
      { ...size, key: "size", label: "输出尺寸", control: "dimensions" as const, valueType: "string" as const,
        default: size?.default ?? "auto", allowCustomValue: true,
        options: size?.options ?? [{ value: "auto", label: "自动" }],
        description: "使用现有 Images 接口的 size 字段发送所选宽高；预设为用户指定，实际输出以原图为准。",
        operations: size?.operations ?? ["image.generate", "image.edit"] as const },
      ...(model.parameters ?? []).filter(parameter => parameter.key !== "size"),
    ];
    if (!parameters.some(parameter => parameter.key === "aspect_ratio")) parameters.push({
      key: "aspect_ratio", label: "画面比例偏好", control: "text", valueType: "string", default: "auto", allowCustomValue: true,
      description: "通过所选 size 宽高表达比例，保存原值，不添加独立上游比例字段。", operations: ["image.generate", "image.edit"],
    });
    return { ...model, parameters, metadata: { ...model.metadata,
      protocol: "openai-images", imageNativeParameterContract: true, imageOpenSizePreferences: true,
      imageSizeOptionsCompleteEnum: false, imageMenuContract: group === "image超分" ? "chentu-image2-upscaling-open-request" : "chentu-image25-open-request",
      ...(group === "1k福利生图" ? { imageFixedResolution: "1K", imageSizeContract: "group-1k-only" } : {}),
    } };
  }
  if (host === "api.3365api.cn" && ["gpt-image-2", "gpt-image-2-2K", "gpt-image-2-4K", "gpt-image-4K"].includes(model.id)) {
    const parameters = cyberAfeiImage2Parameters(model.id);
    return { ...model, parameters: [...parameters, ...(model.parameters ?? []).filter(parameter => !parameters.some(current => current.key === parameter.key))],
      metadata: { ...model.metadata, imageNativeParameterContract: true, imageSupportedResolutions: model.id === "gpt-image-2" ? ["1K"] : model.id === "gpt-image-2-2K" ? ["2K"] : ["2K", "4K"], ...(model.id === "gpt-image-2-2K" ? { imageFixedResolution: "2K", imageSizeOptionsCompleteEnum: false } : {}), imageSizeContract: "cyberafei-exact-historical-inputs", documentationUrl: "https://api.3365api.cn/docs/img2.md" } };
  }
  const fri = ["api.frimodel.com", "platform.frimodel.com"].includes(host) && /^gpt-image-2(?:-(?:low|medium|high|adobe|az|w|wc|o)|\.5(?:-(?:flare|sunburst)(?:-adobe)?)?)?$/u.test(model.id);
  const chentu = host === "tu.988236.xyz" && /^(?:gpt-image-2(?:-(?:1k|2k|4k))?|gpt-image-2自由传参)$/u.test(model.id);
  if (!fri && !chentu) return model;
  const descriptor = fri ? friModelFallbackImageDescriptor(model.id, group) : chentuFallbackImageDescriptor(model.id, group);
  if (!descriptor?.parameters) return model;
  let parameters = descriptor.parameters.map(parameter => {
    const saved = model.parameters?.find(current => current.key === parameter.key);
    // A current keyed capability response takes precedence over static sizes.
    if (parameter.key === "size" && saved?.options?.length && model.metadata?.imageSizeCapabilitiesSource) return saved;
    return parameter;
  });
  const chentuKeyedSizes = chentu && Boolean(model.metadata?.imageSizeCapabilitiesSource) &&
    Boolean(model.parameters?.find(parameter => parameter.key === "size")?.options?.length);
  const chentuTier = chentu ? /-([124])k$/iu.exec(model.id)?.[1] : undefined;
  const chentuFixedTier = chentuTier ? `${chentuTier}K` : chentu && ["1k低价生图", "1k福利生图"].includes(group) ? "1K" : undefined;
  if (chentu && !chentuKeyedSizes) parameters = parameters.map(parameter => parameter.key === "size" ? {
    ...parameter, control: "dimensions", allowCustomValue: true,
    description: "保留该型号档位，补齐用户指定比例尺寸；旧静态像素表不是当前 Key 的完整枚举。实际输出以原图为准。",
  } : parameter);
  const friOpenSize = fri && !/^gpt-image-2(?:-(?:low|medium|high))?$/u.test(model.id);
  const friDeclaredTiers = friOpenSize ? parseSupplierGroupDetails({ name: group,
    description: String(model.metadata?.supplierGroupDescription ?? "") }, "key-groups")?.supportedResolutions ?? [] : [];
  if (friOpenSize) parameters = [...parameters, ...(friDeclaredTiers.length ? [{ key: "size_tier", label: "分辨率档位偏好", control: "select" as const, valueType: "string" as const,
    default: "auto", options: [{ value: "auto", label: "自动" }, ...friDeclaredTiers.map(value => ({ value, label: value }))], description: "当前官方分组声明的档位；未公开该完整型号的逐比例像素映射，请填写 W/H，以原 size 字段提交。档位为应用偏好，不添加上游字段。" }] : []),
    { key: "aspect_ratio", label: "画面比例偏好", control: "text", valueType: "string", default: "auto", allowCustomValue: true,
      description: "应用比例偏好，以明确 W/H 的 size 表达；保存原值，提交前检查 W/H 与比例一致，不猜像素。" }];
  return { ...model, parameters: [...parameters,
    ...(model.parameters ?? []).filter(parameter => !parameters.some(current => current.key === parameter.key))],
    limits: model.limits ?? descriptor.limits,
    metadata: { ...model.metadata, ...(fri ? descriptor.metadata : {}), ...(chentu ? {
      imageSizeOptionsCompleteEnum: chentuKeyedSizes,
      ...(chentuKeyedSizes ? {} : { imageOpenSizePreferences: true,
        ...(chentuFixedTier ? { imageFixedResolution: chentuFixedTier } : {}) }),
    } : {}), ...(friOpenSize ? { imageSupportedResolutions: friDeclaredTiers,
      imageResolutionTierParameter: "size_tier", imageNativeParameterContract: true, imageOpenSizePreferences: true,
      imageNativeResolutionParameter: friDeclaredTiers.length ? "size_tier" : "size", imageSizeContract: "exact-full-id-open-size-no-published-pixel-map" } : {}), imageNativeResolutionOptions: true,
      ...(!friOpenSize ? { imageNativeResolutionParameter: "size" } : {}),
      imageNativeQualityOptions: true, imageMenuContract: fri ? "frimodel-base-image25" : "chentu-fixed-image2-tier" } };
}
