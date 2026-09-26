import type { ModelDescriptor, ModelParameterDescriptor } from "./contracts.js";
import { imageSizeOptions } from "./image-size-presets.js";
import { chuangxiangImageVerification } from "./chuangxiang-image-evidence.js";
import { imageQualityPresetsAfterSuccess, IMAGE_QUALITY_PRESET_DESCRIPTION } from "./image-quality-presets.js";

/** Paid evidence belongs to this exact API origin, account group and model ID. */
export function chuangxiangImageEvidence(
  config: Readonly<Record<string, unknown>>,
  model: string,
) {
  if (
    config.usage === "agent" ||
    config.usage === "disabled" ||
    config.supplierArchived === true
  )
    return undefined;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    if (
      url.origin !== "https://vapi.chuangxiangai.asia" ||
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
  if (String(config.accountKeyGroup ?? config.modelGroup ?? "") !== "生图")
    return undefined;
  return chuangxiangImageVerification[model];
}

export function applyChuangxiangImageCapabilities(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (
    connection.provider !== "openai" ||
    model.metadata?.canvasRunnable === false ||
    !model.operations.includes("image.generate")
  )
    return model;
  const verified = chuangxiangImageEvidence(connection.config, model.id);
  if (!verified) return model;
  const qualityPresets = imageQualityPresetsAfterSuccess(model.id, verified.qualities);
  const historicalSmallOutput = /实际仅 1672×94[01]/u.test(verified.note);
  const note = verified.note.replace("本轮不列为 4K", "按长边计为近似 2K，4K 仍可请求")
    .replace("2K 尚无成功尺寸证据；", historicalSmallOutput ? "" : "2K 尚无成功尺寸证据；");
  const labels: Record<string, string> = {
    high: "高",
    xhigh: "超高",
    max: "最高",
  };
  const parameters: ModelParameterDescriptor[] = [];
  if (verified.tiers.length)
    parameters.push({
      key: "size",
      label: "输出分辨率",
      control: "dimensions",
      valueType: "string",
      default: "auto",
      min: 16,
      max: 3840,
      step: 16,
      // A sampled output size is evidence about that response, not a permanent
      // request restriction. Preserve all request tiers and label their evidence.
      options: imageSizeOptions(["1K", "2K", "4K"]).map((option) => ({
        ...option,
        label: verified.mismatchedSizes.includes(String(option.value))
          ? `${option.label}（实测比例有偏差）`
          : verified.failedSizes.includes(String(option.value))
            ? `${option.label}（本轮服务错误）`
            : option.value === "auto" ||
                verified.testedSizes.includes(String(option.value))
              ? option.label
              : `${option.label}（比例预设）`,
      })),
      description:
        "像素为请求值，渠道可能调整输出；历史返回偏小或临时服务错误不限制请求档位。自动比例优先提示词，其次参考图；实际尺寸见结果。",
    });
  if (verified.qualities.length)
    parameters.push({
      key: "quality",
      label: "请求质量",
      control: "select",
      valueType: "string",
      default: "high",
      options: qualityPresets ?? verified.qualities.map((value) => ({
        value,
        label: `${labels[value] ?? value}（${value}）`,
      })),
      description: qualityPresets ? IMAGE_QUALITY_PRESET_DESCRIPTION : note,
    });
  return {
    ...model,
    pricing: model.pricing ?? {
      kind: "per-image", currency: "CNY", billingUnit: "image",
      unitAmount: model.id.endsWith("-yf") ? 0.08 : 0.04,
      sourceUrl: "https://vapi.chuangxiangai.asia/model-plaza",
      checkedAt: "2026-09-21", confidence: "snapshot",
    },
    // A transient upstream outage must not erase existing controls or operations.
    ...(parameters.length
      ? {
          parameters: [
            ...parameters,
            ...(model.parameters ?? []).filter(
              (p) => !parameters.some((verified) => verified.key === p.key),
            ),
          ],
        }
      : {}),
    metadata: {
      ...model.metadata,
      imageCapabilitiesVerifiedAt: "2026-09-21",
      imageTestedQualities: [...verified.qualities],
      imageCapabilitiesVerificationSource:
        "docs/chuangxiang-image-verification-2026-09-21.md",
      imageCapabilityNote: note,
      imageSupportedResolutions: [...verified.tiers],
      imageRequestResolutions: ["1K", "2K", "4K"],
      imageApproximateResolutions: historicalSmallOutput && !verified.tiers.includes("2K") ? ["2K"] : [],
      imageUnsupportedResolutions: [],
      imageVerifiedResolutionLabel: verified.tiers.length
        ? `实测档位：${verified.tiers.join(" / ")}`
        : "实测档位：待确认",
      imageAcceptedQualityLabel: verified.qualities.length
        ? `请求质量：${verified.qualities.map((value) => labels[value] ?? value).join("、")}`
        : "请求质量：待确认",
    },
  };
}
