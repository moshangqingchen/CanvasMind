import type { ModelDescriptor } from "@super-canvas/providers";
import type { AssetView, CanvasEdge, CanvasNode } from "../components/types";

export type MediaDurationMap = Readonly<Record<string, number>>;

/** Collect only media produced by nodes with an edge directly into targetId. */
export function directLinkedAssetsForNode(
  targetId: string,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  assets: readonly AssetView[],
): AssetView[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const seen = new Set<string>();
  const linked: AssetView[] = [];

  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const source = nodeById.get(edge.source);
    if (!source) continue;
    const ids = [
      ...(typeof source.data.assetId === "string" ? [source.data.assetId] : []),
      ...(source.data.lastOutputAssetIds ?? []),
    ];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const asset = assetById.get(id);
      if (!asset || asset.kind === "text") continue;
      seen.add(id);
      linked.push(asset);
    }
  }
  return linked;
}

function mediaCount(
  assets: readonly AssetView[],
  kind: AssetView["kind"],
): number {
  return assets.filter((asset) => asset.kind === kind).length;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function linkedMediaLimitText(
  model: ModelDescriptor | null | undefined,
  assets: readonly AssetView[],
): string | undefined {
  if (!model || mediaCount(assets, "video") === 0) return undefined;
  const limits = model.limits;
  if (limits?.maxInputVideos === 0) return "当前模型不支持视频输入";
  const details = [
    limits?.maxInputVideos !== undefined
      ? `最多 ${limits.maxInputVideos} 个视频`
      : null,
    limits?.maxInputVideoDurationSeconds !== undefined
      ? `单个最长 ${formatSeconds(limits.maxInputVideoDurationSeconds)} 秒`
      : null,
    limits?.maxTotalInputVideoDurationSeconds !== undefined
      ? `合计最长 ${formatSeconds(limits.maxTotalInputVideoDurationSeconds)} 秒`
      : null,
  ].filter((value): value is string => Boolean(value));
  return details.length > 0 ? details.join("，") : undefined;
}

export function validateLinkedMediaInputs(
  model: ModelDescriptor | null | undefined,
  assets: readonly AssetView[],
  durations: MediaDurationMap = {},
  durationReadFailures: Readonly<Record<string, boolean>> = {},
): string[] {
  if (!model || assets.length === 0) return [];
  const limits = model.limits;
  const imageCount = mediaCount(assets, "image");
  const videos = assets.filter((asset) => asset.kind === "video");
  const audioCount = mediaCount(assets, "audio");
  const audios = assets.filter((asset) => asset.kind === "audio");
  const modelName = model.name || model.id;
  const warnings: string[] = [];
  const supportsVideoByKind = model.inputKinds?.some(
    (kind) => kind === "video" || kind === "video[]",
  );

  if (
    videos.length > 0 &&
    (limits?.maxInputVideos === 0 ||
      (model.inputKinds !== undefined && !supportsVideoByKind))
  ) {
    warnings.push(`模型“${modelName}”不支持输入视频，请删除视频连线或更换模型`);
  } else if (
    limits?.maxInputVideos !== undefined &&
    videos.length > limits.maxInputVideos
  ) {
    warnings.push(
      `模型“${modelName}”最多支持 ${limits.maxInputVideos} 个视频，当前连接了 ${videos.length} 个`,
    );
  }

  if (
    limits?.maxInputImages !== undefined &&
    imageCount > limits.maxInputImages
  ) {
    warnings.push(
      `模型“${modelName}”最多支持 ${limits.maxInputImages} 张图片，当前连接了 ${imageCount} 张`,
    );
  }
  if (
    limits?.maxInputAudios !== undefined &&
    audioCount > limits.maxInputAudios
  ) {
    warnings.push(
      `模型“${modelName}”最多支持 ${limits.maxInputAudios} 个音频，当前连接了 ${audioCount} 个`,
    );
  }
  if (
    limits?.maxInputAssets !== undefined &&
    assets.length > limits.maxInputAssets
  ) {
    warnings.push(
      `模型“${modelName}”最多支持 ${limits.maxInputAssets} 个参考素材，当前连接了 ${assets.length} 个`,
    );
  }

  const maxVideoSeconds = limits?.maxInputVideoDurationSeconds;
  if (maxVideoSeconds !== undefined) {
    videos.forEach((asset, index) => {
      const duration = durations[asset.id];
      if (durationReadFailures[asset.id]) {
        warnings.push(
          `无法读取视频 ${index + 1} 的时长，请确认文件可以播放后重试`,
        );
      } else if (duration !== undefined && duration > maxVideoSeconds + 0.05) {
        warnings.push(
          `视频 ${index + 1} 为 ${formatSeconds(duration)} 秒，超过当前模型单个视频最多 ${formatSeconds(maxVideoSeconds)} 秒`,
        );
      }
    });
  }
  const maxAudioSeconds = limits?.maxInputAudioDurationSeconds;
  if (maxAudioSeconds !== undefined) {
    audios.forEach((asset, index) => {
      const duration = durations[asset.id];
      if (durationReadFailures[asset.id]) {
        warnings.push(
          `无法读取音频 ${index + 1} 的时长，请确认文件可以播放后重试`,
        );
      } else if (duration !== undefined && duration > maxAudioSeconds + 0.05) {
        warnings.push(
          `音频 ${index + 1} 为 ${formatSeconds(duration)} 秒，超过当前模型单个音频最多 ${formatSeconds(maxAudioSeconds)} 秒`,
        );
      }
    });
  }
  const maxTotalSeconds = limits?.maxTotalInputVideoDurationSeconds;
  if (
    maxTotalSeconds !== undefined &&
    videos.length > 0 &&
    videos.every((asset) => durations[asset.id] !== undefined)
  ) {
    const total = videos.reduce(
      (sum, asset) => sum + (durations[asset.id] ?? 0),
      0,
    );
    if (total > maxTotalSeconds + 0.05) {
      warnings.push(
        `参考视频合计 ${formatSeconds(total)} 秒，超过当前模型最多 ${formatSeconds(maxTotalSeconds)} 秒`,
      );
    }
  }
  return warnings;
}
