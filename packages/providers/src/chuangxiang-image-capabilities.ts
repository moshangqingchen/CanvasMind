import type { ModelDescriptor, ModelParameterDescriptor } from "./contracts.js";
import { chuangxiangImageVerification } from "./chuangxiang-image-evidence.js";

/** Paid evidence belongs to this exact API origin, account group and model ID. */
export function chuangxiangImageEvidence(
  config: Readonly<Record<string, unknown>>,
  model: string,
) {
  if (
    config.usage === "agent" ||
    config.manualProtocol === true ||
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
    model.metadata?.source === "manual" || model.metadata?.source === "paid-test" || model.metadata?.protocolEvidence === "paid-test" ||
    model.metadata?.canvasRunnable === false ||
    !model.operations.includes("image.generate")
  )
    return model;
  const verified = chuangxiangImageEvidence(connection.config, model.id);
  if (!verified) return model;
  const metadata = { ...model.metadata };
  for (const key of ["imageOutputDimensions", "imageOutputReferenceDimensions", "imageResolutionProfiles", "imageCustomDimensionRules", "imageFixedResolution", "imageNativeResolutionParameter"])
    delete metadata[key];
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
      allowCustomValue: true,
      // A sampled output size is evidence about that response, not a permanent
      // request restriction. Preserve all request tiers and label their evidence.
      options: [{ value: "auto", label: "自动（供应商决定）" },
        ...[...new Set([...verified.testedSizes, ...verified.mismatchedSizes, ...verified.failedSizes,
          ...(historicalSmallOutput ? ["3840x2160"] : [])])].map(value => ({ value,
          label: `历史请求 · ${value.replace("x", " × ")}${verified.mismatchedSizes.includes(value)
            ? "（实测比例有偏差）" : verified.failedSizes.includes(value) ? "（本轮服务错误）" : ""}` }))],
      description:
        "所列仅为本完整型号历史请求值，不是逐比例像素表或像素范围；其他宽高按输入发送。历史返回偏小或临时服务错误不限制后续尺寸，实际输出见原图。",
    });
  if (verified.qualities.length)
    parameters.push({
      key: "quality",
      label: "请求质量",
      control: "select",
      valueType: "string",
      default: verified.qualities.at(-1) ?? "high",
      options: verified.qualities.map((value) => ({
        value,
        label: `${labels[value] ?? value}（${value}）`,
      })),
      description: note,
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
      ...metadata,
      imageNativeParameterContract: true,
      imageNativeResolutionOptions: true,
      imageResolutionMode: "historical-request-samples-and-open-size",
      imageTierSource: "historical-request-output-sample",
      imagePixelBudgetPublished: false,
      imageRequestSizeSamples: [...verified.testedSizes],
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
