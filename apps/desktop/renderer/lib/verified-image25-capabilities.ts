import type {
  ModelDescriptor,
  ModelParameterDescriptor,
} from "@super-canvas/providers";
import { cangyuanCurrentModel, isCangyuanCurrentModel } from "@super-canvas/providers/cangyuan-current-models";
import { supplierKeyForConnection } from "./supplier-identity";
import { matchesSupplierTemplate } from "./supplier-template-source";
import { imageSizeOptions, type ImageSizeTier } from "@super-canvas/providers/image-size-presets";
import { IMAGE25_REQUEST_SAMPLES } from "./image25-request-samples";
import { IMAGE_QUALITY_PRESET_DESCRIPTION } from "@super-canvas/providers/image-quality-presets";
import { mikotoGroup, MIKOTO_IMAGE_HIGH_GROUP, MIKOTO_IMAGE_MEDIUM_GROUP } from "./mikoto-presets";
import { applySupplierImageConstraints } from "@super-canvas/providers/supplier-image-constraints";

const operations = ["image.generate", "image.edit"] as const;
const qualities = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
const qualityLabels = ["自动", "低", "中", "高", "超高", "最高"];

/** Exact supplier/group/model evidence; never infer 2.5 capabilities from its name.
 * See docs/image25-provider-verification.md for docs, probes and limitations.
 */
export function applyVerifiedImage25Capabilities(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (!matchesSupplierTemplate(connection))
    return model;
  const supplier = supplierKeyForConnection(connection);
  const group = String(connection.config.modelGroup ?? "");
  const mikotoDeclaredGpt = supplier === "mikoto" &&
    [MIKOTO_IMAGE_HIGH_GROUP, MIKOTO_IMAGE_MEDIUM_GROUP].includes(group) && model.id === "gpt-image-2";
  const mikotoOneK =
    supplier === "mikoto" &&
    group === "生图（1k）" &&
    /^gpt-image-2(?:\.5-(?:flare|sunburst))?$/u.test(model.id);
  const mikotoNativeGpt = supplier === "mikoto" &&
    ["生图（原生4k", "生图（原生4k）"].includes(group) && model.id === "gpt-image-2";
  const full =
    (supplier === "mikoto" &&
      ["生图（原生4k", "生图（原生4k）"].includes(group) &&
      model.id === "gpt-image-2.5-flare") ||
    (supplier === "frimodel" &&
      group === "gpt_image_adobe" &&
      /^gpt-image-2\.5-(flare|sunburst)-adobe$/u.test(model.id));
  const twoK =
    supplier === "cyberafei" &&
    group === "image-2稳定生图" &&
    model.id === "gpt-image-2.5";
  const chentuAdobe =
    supplier === "chentu" &&
    group === "低价Adobe生图" &&
    /^gpt-image-2\.5-(flare|sunburst)$/u.test(model.id);
  const chentuFlareTwoK = chentuAdobe && model.id === "gpt-image-2.5-flare";
  const advancedQuality = full || chentuAdobe;
  const cangyuanTier =
    supplier === "cangyuan" &&
    ["IMAGE", "IMAGE-备用分组", "全模型-无claude/gpt"].includes(group)
      ? (/^gpt-image-2(?:\.5-(?:flare|sunburst))?-(1k|2k|4k)$/iu
          .exec(model.id)?.[1]
          ?.toUpperCase() as ImageSizeTier | undefined)
      : undefined;
  if (!full && !twoK && !cangyuanTier && !chentuAdobe && !mikotoOneK && !mikotoNativeGpt && !mikotoDeclaredGpt)
    return model;
  // An actual key denial must remain unavailable even for a verified model.
  if (
    model.metadata?.canvasRunnable === false &&
    /403|权限|未开通|拒绝|下架|停用/u.test(
      String(model.metadata.canvasUnavailableReason ?? ""),
    )
  )
    return model;
  if (supplier === "cangyuan" && isCangyuanCurrentModel(model.id)) return cangyuanCurrentModel(model);
  if (mikotoDeclaredGpt) {
    const declared = mikotoGroup(group)!.models[0]!;
    const metadata = { ...model.metadata, ...declared.metadata };
    delete metadata.parameterControlsUnavailable;
    delete metadata.canvasUnavailableReason;
    return { ...model, parameters: structuredClone(declared.parameters), metadata };
  }
  if (mikotoNativeGpt) {
    const size = mikotoGroup(group)?.models.find(m => m.id === model.id)?.parameters?.find(p => p.key === "size");
    return size ? { ...model, parameters: (model.parameters ?? []).map(p => p.key === "size" ? structuredClone(size) : p) } : model;
  }
  if (mikotoOneK) {
    if (["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model.id))
      return applySupplierImageConstraints(connection, model);
    // 2026-09-13: all eleven ratios produced matching image aspect ratios.
    // The channel rescales requested pixels; this does not establish 2K/4K
    // support, new quality tiers, or another model's capabilities.
    return {
      ...model,
      parameters: model.parameters?.map((parameter) =>
        parameter.key === "size" && parameter.control === "dimensions"
          ? {
              ...parameter,
              default: "auto",
              step: 16,
              options: imageSizeOptions(["1K"]),
              description:
                model.id === "gpt-image-2.5-flare"
                  ? "1K 渠道的 11 种比例已实测；尺寸为请求值，实际像素由渠道调整。自动比例优先提示词，其次参考图。"
                  : "1K 比例请求预设，未逐项实测；实际像素由渠道调整。自动比例优先提示词，其次参考图。",
            }
          : parameter,
      ),
      metadata: {
        ...model.metadata,
        ...(model.id === "gpt-image-2.5-flare" ? {
          imageAspectRatiosVerifiedAt: "2026-09-13",
          imageAspectRatiosVerificationSource: "docs/mikoto-1k-ratios-2026-09-13.md",
        } : { imageSizePresetSource: "docs/image-size-audit-2026-09-15.md" }),
      },
    };
  }
  if (cangyuanTier) {
    // Saved authenticated inventories can outlive the marketplace descriptor.
    // Refresh only an already-declared dimension control for this fixed SKU.
    return {
      ...model,
      parameters: model.parameters?.map((parameter) =>
        parameter.key === "size" && parameter.control === "dimensions"
          ? {
              ...parameter,
              default: "auto",
              options: imageSizeOptions([cangyuanTier]),
            }
          : parameter,
      ),
    };
  }
  const sampleHost = supplier === "mikoto" ? "api.mikoto.vip" : supplier === "frimodel" ? "api.frimodel.com" : supplier === "chentu" ? "tu.988236.xyz" : "api.3365api.cn";
  const sampleKey = `${sampleHost}:${model.id}` as keyof typeof IMAGE25_REQUEST_SAMPLES;
  const samples = IMAGE25_REQUEST_SAMPLES[sampleKey] ?? [];
  const size: ModelParameterDescriptor = {
    key: "size", label: "输出尺寸（size）", control: "dimensions", valueType: "string", default: "auto", step: 1, allowCustomValue: true,
    options: [{ label: "自动", value: "auto" }, ...samples.map(sample => ({ value: sample.size,
      label: `${sample.tier} · ${sample.size.replace("x", " × ")}（历史请求样本）` }))],
    operations, description: "该完整型号的历史 size 请求样本；可输入独立 W/H。样本不是完整枚举，未套用通用像素表、步长、边长或像素预算。实际输出以原图为准。",
  };
  const quality: ModelParameterDescriptor = {
    key: "quality",
    label: "质量",
    control: "select",
    valueType: "string",
    default: "high",
    options: qualities
      .map((value, index) => ({
        label: `${qualityLabels[index]}（${value}）`,
        value,
      })),
    operations,
    description:
      IMAGE_QUALITY_PRESET_DESCRIPTION,
  };
  const parameters = (model.parameters ?? []).filter(
    (p) => p.key !== "size" && (!advancedQuality || p.key !== "quality"),
  );
  const metadata = {
    ...model.metadata,
    canvasRunnable: true,
    supportsImageEdit: true,
    image25VerifiedAt: "2026-09-10",
    imageNativeParameterContract: true,
    imageOpenSizePreferences: true,
    imageSupportedResolutions: full || chentuAdobe ? ["1K", "2K", "4K"] : ["1K", "2K"],
    imageSizeContract: "same-full-id-historical-request-samples",
    imageTierSource: "historical-request-output-sample",
    imageCapabilitiesVerifiedAt: chentuFlareTwoK ? "2026-09-14" : "2026-09-10",
    imageCapabilitiesVerificationSource: chentuAdobe ? "docs/chentu-image25-recheck-2026-09-10.md" : "docs/image25-provider-verification.md",
    ...(chentuAdobe ? { imageApproximateResolutions: ["2K"] } : {}),
    image25VerificationSource: "docs/image25-provider-verification.md",
    ...(chentuAdobe
      ? {
          image25VerificationSource:
            "docs/chentu-image25-recheck-2026-09-10.md",
        }
      : {}),
    ...(chentuFlareTwoK
      ? {
          image2KVerifiedAt: "2026-09-14",
          image2KVerificationSource: "docs/chentu-2k-recheck-2026-09-14.md",
          image2KAllowsApproximateOutput: true,
        }
      : {}),
    ...(chentuAdobe && !chentuFlareTwoK
      ? { image2KPresetSource: "docs/image-size-audit-2026-09-15.md", image2KAllowsApproximateOutput: true }
      : {}),
  };
  delete (metadata as Record<string, unknown>).canvasUnavailableReason;
  delete (metadata as Record<string, unknown>).parameterControlsUnavailable;
  return {
    ...model,
    parameters: [size, ...(advancedQuality ? [quality] : []), { key: "aspect_ratio", label: "画面比例偏好", control: "text", valueType: "string", default: "auto", placeholder: "auto / WIDTH:HEIGHT", description: "应用比例偏好，通过 W/H 表达；请求只发送 size。", operations }, ...parameters.filter(parameter => parameter.key !== "aspect_ratio")],
    operations,
    inputKinds: ["text", "image"],
    outputKinds: ["image"],
    metadata,
  };
}
