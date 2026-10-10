import type { ModelDescriptor } from "./contracts.js";

const ids = new Set(["grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-quality"]);

/** The group number and complete ID are part of the measured contract. */
export function hangImageBaseUrl(config: Readonly<Record<string, unknown>>, modelId: string): string | undefined {
  if (!ids.has(modelId) || String(config.accountKeyGroupId ?? "") !== "74") return;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    if (url.origin !== "https://api.hangzhale.com" || url.username || url.password || url.search || url.hash ||
        !/^(?:\/v1)?\/?$/u.test(url.pathname)) return;
    return `${url.origin}/v1`;
  } catch { return; }
}

export function applyHangImageCapabilities(connection: { provider: string; config: Readonly<Record<string, unknown>> }, model: ModelDescriptor): ModelDescriptor {
  if (connection.provider !== "openai" || !hangImageBaseUrl(connection.config, model.id)) return model;
  return { ...model, parameters: [], metadata: { ...model.metadata,
    imageNativeParameterContract: true, imageParameterContract: "hang-group74-default-request",
    imageSupportedResolutions: [], imageOutputDimensions: undefined, qualitySupport: "not-published",
    imageParameterContractNote: "当前仅核实不指定尺寸和质量的默认请求；供应商未公布本型号的可选比例、像素与质量规则。已实测型号返回 1024 × 1024 JPEG，账单的 2K 为计费标签，不是固定输出像素；已保存参数保留。",
    imageDefaultOutputEvidence: model.id === "grok-imagine-image-quality" ? "generation-502-reconcile-original" : "jpeg-1024x1024-default-sample",
    ...(model.id !== "grok-imagine-image-quality" ? { imageReferenceEditEvidence: "one-jpeg-multipart-default-sample", referenceEditEndpoint: "/v1/images/edits" } : {}),
    imageContractCheckedAt: "2026-10-10T02:05:50.902Z", imageContractEvidence: "docs/supplier-hang-group74-image-probe-2026-10-09.md" } };
}
