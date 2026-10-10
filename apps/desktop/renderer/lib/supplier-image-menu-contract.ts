import type { ModelDescriptor } from "@super-canvas/providers";
import { applyHangImageCapabilities } from "@super-canvas/providers/hang-image-contract";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";
import { friModelFallbackImageDescriptor } from "./frimodel-presets";

/** Restore exact supplier controls before generic capability/history enrichment. */
export function supplierImageMenuContract(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (connection.provider !== "openai" || !model.operations.some(operation => operation.startsWith("image."))) return model;
  const hang = applyHangImageCapabilities(connection, model);
  if (hang !== model) return hang;
  let host: string;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
        !/^(?:\/v1)?\/?$/u.test(url.pathname)) return model;
    host = url.hostname;
  } catch { return model; }
  const group = String(connection.config.accountKeyGroup ?? connection.config.modelGroup ?? "");
  if (host === "tu.988236.xyz" && group === "grok生图" &&
      ["grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-image-2.0福利"].includes(model.id) && !model.metadata?.imageSizeCapabilitiesSource) {
    // The supplier's API docs require its keyed capability response for exact
    // sizes; that endpoint currently returns 404 for this group. Neither the
    // group label nor the generic image creator supplies a Grok pixel contract.
    // Keep its documented response transport and do not revive GPT controls.
    return { ...model, parameters: [{ key: "response_format", label: "返回方式", control: "select", default: "url",
      options: [{ value: "url", label: "图片链接" }, { value: "b64_json", label: "Base64" }] }],
      metadata: { ...model.metadata, imageNativeParameterContract: true, imageParameterContract: "keyed-size-schema-unavailable",
        imageSupportedResolutions: [], imageOutputDimensions: undefined, qualitySupport: "provider-decided",
        imageParameterContractNote: "本分组说明支持 1K / 2K，但当前尺寸能力接口未返回可确认的比例、像素和质量选项。新任务不指定这些参数，实际尺寸以原图为准；已保存的参数继续保留。",
        documentationUrl: "https://tu.988236.xyz/docs/api-media.zh-CN.md", contractCheckedAt: "2026-10-10T01:38:27.000Z" } };
  }
  const fri = ["api.frimodel.com", "platform.frimodel.com"].includes(host) && /^gpt-image-2\.5-(?:flare|sunburst)$/u.test(model.id);
  const chentu = host === "tu.988236.xyz" && /^gpt-image-2-(?:2k|4k)$/u.test(model.id);
  if (!fri && !chentu) return model;
  const descriptor = fri ? friModelFallbackImageDescriptor(model.id, group) : chentuFallbackImageDescriptor(model.id, group);
  if (!descriptor?.parameters) return model;
  const parameters = descriptor.parameters.map(parameter => {
    const saved = model.parameters?.find(current => current.key === parameter.key);
    // A current keyed capability response takes precedence over static sizes.
    if (parameter.key === "size" && saved?.options?.length && model.metadata?.imageSizeCapabilitiesSource) return saved;
    return parameter;
  });
  return { ...model, parameters: [...parameters,
    ...(model.parameters ?? []).filter(parameter => !parameters.some(current => current.key === parameter.key))],
    limits: model.limits ?? descriptor.limits,
    metadata: { ...model.metadata, imageNativeResolutionOptions: true, imageNativeResolutionParameter: "size",
      imageNativeQualityOptions: true, imageMenuContract: fri ? "frimodel-base-image25" : "chentu-fixed-image2-tier" } };
}
