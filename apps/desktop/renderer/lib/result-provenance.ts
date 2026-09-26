import { renderPromptParts } from "@super-canvas/core";
import type { AssetView, CanvasNodeData, GenerationDetails, GenerationInputAsset, RunSnapshot } from "../components/types";

export function generationDetailsFromRun(node: RunSnapshot["nodes"][number]): GenerationDetails {
  const request = node.request;
  return {
    ...(request?.submissionPhase !== undefined ? { submissionPhase: request.submissionPhase } : {}),
    ...(request?.operation !== undefined ? { operation: request.operation } : {}),
    ...(request?.prompt !== undefined ? { prompt: request.prompt } : {}),
    ...(request?.inputAssetIds !== undefined ? { inputAssetIds: request.inputAssetIds } : {}),
    ...(request?.inputAssets !== undefined ? { inputAssets: request.inputAssets } : {}),
    outputCount: node.outputAssetIds.length,
    ...(["succeeded", "failed", "cancelled"].includes(node.status) && node.updatedAt ? { finishedAt: node.updatedAt } : {}),
  };
}

export function resultReferenceInputs(details: GenerationDetails, assets: readonly AssetView[] = []) {
  // An absent input list is unknown; an explicitly saved empty list means no references.
  const ids = details.inputAssetIds ?? details.inputAssets?.map((asset) => asset.id);
  if (!ids) return undefined;
  return [...new Set(ids)].map((id): GenerationInputAsset => {
    const saved = details.inputAssets?.find((asset) => asset.id === id);
    const current = assets.find((asset) => asset.id === id);
    return { id, name: saved?.name ?? current?.name, kind: saved?.kind ?? current?.kind, role: saved?.role };
  });
}

export function resultPrompt(data: CanvasNodeData, details: GenerationDetails): string | undefined {
  if (details.prompt !== undefined) return details.prompt;
  if (!data.generatedPromptParts) return undefined;
  return renderPromptParts(data.generatedPromptParts, {
    resolveAsset: (id) => `@${details.inputAssets?.find((asset) => asset.id === id)?.name ?? data.assets?.find((asset) => asset.id === id)?.name ?? id}`,
  }).trim();
}

export function resultElapsed(start?: string, end?: string): string {
  const milliseconds = Date.parse(end ?? "") - Date.parse(start ?? "");
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "未记录";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分 ${seconds % 60} 秒`;
}

export function resultFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "未记录";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}
