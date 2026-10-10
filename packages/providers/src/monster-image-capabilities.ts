import type { ModelDescriptor, ModelParameterDescriptor } from "./contracts.js";
import { imageSizeOptions, type ImageSizeTier } from "./image-size-presets.js";
import { imageQualityPresetsAfterSuccess, IMAGE_QUALITY_PRESET_DESCRIPTION } from "./image-quality-presets.js";

export interface MonsterImageEvidence {
  tiers: readonly ImageSizeTier[];
  qualities: readonly string[];
  /** Only successful requests with a matching output aspect ratio belong here. */
  testedSizes: readonly string[];
  note: string;
}

const groupNames = [
  "B1-GPT生图原生渠道V1",
  "B2-GPT生图原生渠道V2（推荐）",
  "B3-GPT生图-特惠渠道",
  "B4-GPT生图原生渠道V3（高质量）",
] as const;

// Each entry is scoped to an exact API origin, account group and model ID.
// Source: docs/monster-image-verification-2026-09-20.md. Model-list presence
// and group price fields are never evidence of working resolution/quality.
const nativeGpt2: MonsterImageEvidence = {
  tiers: ["1K", "2K", "4K"],
  qualities: ["auto", "low", "medium", "high", "xhigh", "max"],
  testedSizes: [
    "1024x1024",
    "2048x2048",
    "3840x2160",
    "1184x880",
    "880x1184",
    "1536x2720",
    "3840x1648",
  ],
  note: "1K、2K、4K 已出图；实际像素可能调整。部分质量请求被统一返回 medium，六档只表示参数可提交，不保证六种独立画质。",
};
const nativeGpt25: MonsterImageEvidence = {
  ...nativeGpt2,
  note: "1K、2K、4K 已出图，部分尺寸会调整。六档参数可提交，但无效质量值也能出图，不能据此确认六种独立画质。",
};
const approximateGpt25: MonsterImageEvidence = {
  ...nativeGpt25,
  note: "1K、2K、4K 已出图。4K 横图在 high、max 下实际返回 3584×2016，按接近的尺寸归为 4K。六档质量参数可提交，实际像素和画质由渠道调整。",
};
const discounted: MonsterImageEvidence = {
  tiers: ["1K", "2K"],
  qualities: ["medium", "high", "xhigh", "max"],
  testedSizes: ["1024x1024", "2048x2048", "1536x2720", "3120x1344"],
  note: "1K、2K 已出图，不支持 4K。本次 low、auto 请求连接中断，暂不列出；其余质量参数可提交，独立画质差异未确认。",
};
const discountedGpt25: MonsterImageEvidence = {
  ...discounted,
  qualities: nativeGpt2.qualities,
  testedSizes: [...discounted.testedSizes, "1184x880", "880x1184"],
  note: "1K、2K 已出图，不支持 4K。六档质量参数可提交，独立画质差异未确认。",
};
const approximateAlias: MonsterImageEvidence = {
  tiers: ["1K", "2K", "4K"],
  qualities: ["high", "max"],
  testedSizes: ["1024x1024", "1536x2720", "3840x2160"],
  note: "1K、2K、4K 已出图。high、max 的 4K 请求实际返回 3584×2016，按接近的尺寸归为 4K。本型号仅实测这两个质量参数。",
};
const nativeAlias: MonsterImageEvidence = {
  tiers: ["1K", "2K", "4K"],
  qualities: ["high"],
  testedSizes: ["1024x1024", "1536x2720", "3840x2160"],
  note: "1K、2K、4K 已匹配请求尺寸。本型号仅实测 high 质量，其他质量参数未新增。",
};
const discountedAlias: MonsterImageEvidence = {
  tiers: ["1K", "2K"],
  qualities: ["high"],
  testedSizes: ["1024x1024", "1536x2720"],
  note: "1K、2K 已匹配请求尺寸，不支持 4K。本型号仅实测 high 质量。",
};
const evidence: Readonly<
  Record<string, Readonly<Record<string, MonsterImageEvidence>>>
> = {
  [groupNames[0]]: {
    "gpt-image-2": nativeGpt2,
    "gpt-image-2.5": approximateGpt25,
    "gpt-image-2.5-flare": approximateAlias,
    "gpt-image-2.5-sunburst": approximateAlias,
  },
  [groupNames[1]]: {
    "gpt-image-2": nativeGpt2,
    "gpt-image-2.5": approximateGpt25,
    "gpt-image-2.5-flare": approximateAlias,
    "gpt-image-2.5-sunburst": approximateAlias,
  },
  [groupNames[2]]: {
    "gpt-image-2": discounted,
    "gpt-image-2.5": discountedGpt25,
    "gpt-image-2.5-flare": discountedAlias,
    "gpt-image-2.5-sunburst": discountedAlias,
  },
  [groupNames[3]]: {
    "gpt-image-2": nativeGpt2,
    "gpt-image-2.5": nativeGpt25,
    "gpt-image-2.5-flare": nativeAlias,
    "gpt-image-2.5-sunburst": nativeAlias,
  },
};

export function monsterImageEvidence(
  config: Readonly<Record<string, unknown>>,
  model: string,
): MonsterImageEvidence | undefined {
  if (
    config.usage === "agent" ||
    config.usage === "disabled" ||
    config.supplierArchived === true
  )
    return undefined;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    if (
      url.origin !== "https://api.eaheng.com" ||
      !/^(?:\/v1)?\/?$/u.test(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
  } catch {
    return undefined;
  }
  const group = String(config.accountKeyGroup ?? config.modelGroup ?? "");
  if (!groupNames.some((name) => name === group)) return undefined;
  return evidence[group]?.[model];
}

export function applyMonsterImageCapabilities(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (
    connection.provider !== "openai" ||
    model.metadata?.canvasRunnable === false ||
    !model.operations.includes("image.generate")
  )
    return model;
  const verified = monsterImageEvidence(connection.config, model.id);
  if (!verified) return model;
  const qualityPresets = imageQualityPresetsAfterSuccess(model.id, verified.qualities);
  const labels: Record<string, string> = {
    auto: "自动",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高",
    max: "最高",
  };
  const size: ModelParameterDescriptor = {
    key: "size",
    label: "输出分辨率",
    control: "dimensions",
    valueType: "string",
    default: "auto",
    min: 16,
    max: 3840,
    step: 16,
    options: imageSizeOptions(verified.tiers).map((option) => ({
      ...option,
      label:
        option.value === "auto" ||
        verified.testedSizes.includes(String(option.value))
          ? option.label
          : `${option.label}（比例预设）`,
    })),
    description:
      "K 档位与比例一起选择；标为比例预设的组合未逐项实测。所列像素是请求值，渠道可能调整实际输出。自动比例优先提示词，其次参考图。",
  };
  const quality: ModelParameterDescriptor = {
    key: "quality",
    label: "请求质量",
    control: "select",
    valueType: "string",
    default: verified.qualities.includes("high")
      ? "high"
      : (verified.qualities[0] ?? "auto"),
    options: qualityPresets ?? verified.qualities.map((value) => ({
      value,
      label: `${labels[value] ?? value}（${value}）`,
    })),
    description: qualityPresets ? IMAGE_QUALITY_PRESET_DESCRIPTION : verified.note,
  };
  return {
    ...model,
    parameters: [
      size,
      quality,
      ...(model.parameters ?? []).filter(
        (p) => p.key !== "size" && p.key !== "quality",
      ),
    ],
    metadata: {
      ...model.metadata,
      imageCapabilitiesVerifiedAt: "2026-09-20",
      imageNativeQualityOptions: true,
      imageTestedQualities: [...verified.qualities],
      imageCapabilitiesVerificationSource:
        "docs/monster-image-verification-2026-09-20.md",
      imageCapabilityNote: verified.note,
      imageSupportedResolutions: [...verified.tiers],
      imageUnsupportedResolutions: /不支持\s*4K/iu.test(verified.note) ? ["4K"] : [],
      imageVerifiedResolutionLabel: `实测档位：${verified.tiers.join(" / ")}`,
      imageAcceptedQualityLabel: `请求质量：${verified.qualities.map((value) => labels[value] ?? value).join("、")}`,
    },
  };
}
