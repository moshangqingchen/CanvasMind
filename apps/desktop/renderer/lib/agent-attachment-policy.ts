import type { DirectorModelCapabilities } from "@super-canvas/director";

export interface AgentAttachmentLimits {
  maxImages?: number;
  maxVideos?: number;
  maxAudios?: number;
  maxAssets?: number;
}
export interface AgentAttachmentAsset { id: string; kind: string; size: number }
export interface AgentAttachmentModel {
  capabilities: Pick<DirectorModelCapabilities, "imageInput" | "audioInput" | "videoInput">;
  inputLimits?: AgentAttachmentLimits;
}

/** These are application memory budgets, never claims about provider limits. */
export function agentAttachmentError(
  assets: readonly AgentAttachmentAsset[],
  model: AgentAttachmentModel,
  helper?: AgentAttachmentModel,
): string | undefined {
  if (assets.length > 16) return "本应用每轮最多发送 16 个附件，请减少后重试。";
  if (assets.some(asset => asset.size > 16 * 1024 * 1024)) return "本应用单个附件不能超过 16 MB。";
  if (assets.reduce((sum, asset) => sum + asset.size, 0) > 24 * 1024 * 1024) return "本应用本轮附件总大小不能超过 24 MB。";
  if (assets.some(asset => !["image", "audio", "video"].includes(asset.kind))) return "智能体附件只支持图片、音频和视频。";
  for (const [kind, capability, limit, label] of [
    ["image", "imageInput", "maxImages", "图片"],
    ["audio", "audioInput", "maxAudios", "音频"],
    ["video", "videoInput", "maxVideos", "视频"],
  ] as const) {
    const count = assets.filter(asset => asset.kind === kind).length;
    const target = kind === "image" && !model.capabilities.imageInput ? helper : model;
    // Unsupported images retain the explicit visual-helper / text-only flow.
    if (!target || !count) continue;
    if (!target.capabilities[capability]) return `当前模型或接入协议不支持${label}输入，请切换模型或移除此附件。`;
    const maximum = target.inputLimits?.[limit];
    if (maximum !== undefined && count > maximum) return `当前模型每轮最多接受 ${maximum} 个${label}附件，本轮为 ${count} 个。`;
  }
  const modelAssets = assets.filter(asset => asset.kind !== "image" || model.capabilities.imageInput);
  if (model.inputLimits?.maxAssets !== undefined && modelAssets.length > model.inputLimits.maxAssets)
    return `当前模型每轮最多接受 ${model.inputLimits.maxAssets} 个附件，本轮为 ${modelAssets.length} 个。`;
  const helperCount = assets.length - modelAssets.length;
  if (helper?.inputLimits?.maxAssets !== undefined && helperCount > helper.inputLimits.maxAssets)
    return `视觉助手每轮最多接受 ${helper.inputLimits.maxAssets} 个附件，本轮为 ${helperCount} 个。`;
}

/** Keep this turn intact; add the most recent compatible history that fits. */
export function selectAgentAttachments<T extends AgentAttachmentAsset>(
  current: readonly T[], previous: readonly T[], model: AgentAttachmentModel, helper?: AgentAttachmentModel,
) {
  const selected = [...new Map(current.map(asset => [asset.id, asset])).values()];
  const error = agentAttachmentError(selected, model, helper);
  if (error) throw new Error(error);
  const ids = new Set(selected.map(asset => asset.id));
  const omitted: string[] = [];
  for (const asset of [...previous].reverse()) {
    if (ids.has(asset.id)) continue;
    ids.add(asset.id);
    if (agentAttachmentError([...selected, asset], model, helper)) omitted.push(asset.id);
    else selected.push(asset);
  }
  return { selected, omitted };
}
