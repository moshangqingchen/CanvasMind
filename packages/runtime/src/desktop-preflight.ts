import type { WorkflowGraph } from "@super-canvas/core";
import { getImageEditingCapabilities, restRequestRequiresPublicAssets, referenceImageHostingEnabled, secureSkillRequiresPublicAssets, bananaRequiresPublicAssets, chuangxiangRequiresPublicAssets } from "@super-canvas/providers";
import { localReferenceChannel, localReferenceChannelConfigured } from "./reference-channel.js";

export class DesktopPublicAssetError extends Error {
  readonly code = "DESKTOP_PUBLIC_ASSETS_UNAVAILABLE";
  constructor() { super("该模型需要参考图 HTTPS 链接。请在设置的“素材通道”中连接本机通道，或在对应分组启用“参考图临时链接”；本次工作流未提交付费生成。"); }
}

function hasAssetReference(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    key !== "__runtimeConnection" && ((["assetId", "maskAssetId", "maskSourceAssetId"].includes(key) && typeof child === "string" && child.length > 0) || hasAssetReference(child)));
}

/** Reject unsupported public-asset workflows before any upstream paid submit. */
export function assertDesktopPublicAssets(graph: WorkflowGraph, selected: ReadonlySet<string>): void {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return;
  if (localReferenceChannel()) return;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const containsMedia = (id: string, visited = new Set<string>()): boolean => {
    if (visited.has(id)) return false;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return false;
    const data = node.data as Record<string, unknown>;
    if (hasAssetReference(data)) return true;
    const type = data.nodeType ?? node.type;
    if (["asset-input", "image-generation", "video-generation", "music-generation"].includes(String(type))) return true;
    return graph.edges.filter((edge) => edge.target === id).some((edge) => containsMedia(edge.source, visited));
  };
  for (const node of graph.nodes) {
    if (!selected.has(node.id)) continue;
    const data = node.data as Record<string, unknown>;
    const connection = data.__runtimeConnection as { provider?: string; cloudGeneration?: unknown; config?: { baseUrl?: string; defaultModel?: string; connector?: unknown; referenceImageHosting?: string } } | undefined;
    if (connection?.cloudGeneration && (data.nodeType ?? node.type) === "image-generation") continue;
    const provider = String(connection?.provider ?? data.provider);
    if (!localReferenceChannelConfigured() && referenceImageHostingEnabled(connection?.config)) continue;
    const operation = (data.nodeType ?? node.type) === "image-generation" ? "image.edit" : "video.image-to-video";
    const model = typeof data.model === "string" && data.model ? data.model : connection?.config?.defaultModel;
    const parameters = data.parameters && typeof data.parameters === "object" ? data.parameters as Record<string, unknown> : {};
    const urlMask = parameters.maskAssetId && getImageEditingCapabilities({ provider, config: connection?.config ?? {} }, model ?? "", parameters).mask === "url";
    if (!(provider === "rest" && restRequestRequiresPublicAssets(connection?.config?.connector, model, operation, connection?.config)) &&
        !secureSkillRequiresPublicAssets(provider, connection?.config, model, operation) &&
        !chuangxiangRequiresPublicAssets(provider, connection?.config, model, operation) &&
        !bananaRequiresPublicAssets(provider, connection?.config, model) && !urlMask) continue;
    if (hasAssetReference(data) || graph.edges.filter((edge) => edge.target === node.id).some((edge) => containsMedia(edge.source))) {
      throw new DesktopPublicAssetError();
    }
  }
}
