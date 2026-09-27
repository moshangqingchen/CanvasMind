import {
  readImageDesignReview,
  type ImageReviewStatus,
} from "@super-canvas/core";
import type {
  AssetView,
  CanvasEdge,
  CanvasNode,
  RunSnapshot,
} from "../components/types";

export type ImageDesignSource = NonNullable<
  RunSnapshot["nodes"][number]["request"]
>;

/** An older list request may finish after a successful review PATCH. */
export function mergeDesignReviewAssets(
  current: readonly AssetView[],
  incoming: readonly AssetView[],
): AssetView[] {
  const previous = new Map(current.map((asset) => [asset.id, asset]));
  return incoming.map((asset) => {
    const existing = previous.get(asset.id);
    if (
      !existing ||
      readImageDesignReview(existing.metadata).revision <=
        readImageDesignReview(asset.metadata).revision
    )
      return asset;
    return {
      ...asset,
      metadata: {
        ...asset.metadata,
        imageDesignReview: existing.metadata.imageDesignReview,
      },
    };
  });
}

export function filterDesignImages(
  assets: readonly AssetView[],
  query: string,
  status: ImageReviewStatus | "all",
): AssetView[] {
  const term = query.trim().toLocaleLowerCase();
  return assets.filter((asset) => {
    if (asset.kind !== "image" || (typeof asset.metadata.runId !== "string" && readImageDesignReview(asset.metadata).revision === 0))
      return false;
    const review = readImageDesignReview(asset.metadata);
    return (
      (status === "all" || review.status === status) &&
      (!term ||
        `${asset.name}\n${review.note}`.toLocaleLowerCase().includes(term))
    );
  });
}

/** Resolve the immutable run that produced this image, never today's node settings. */
export function imageDesignSourceForAsset(
  asset: AssetView,
  snapshot: RunSnapshot,
): ImageDesignSource {
  const node = snapshot.nodes.find(
    (entry) =>
      entry.nodeId === asset.metadata.nodeId &&
      entry.outputAssetIds.includes(asset.id),
  );
  if (
    asset.kind !== "image" ||
    snapshot.run.id !== asset.metadata.runId ||
    !node?.request?.provider ||
    !node.request.connectionId ||
    !node.request.model
  ) {
    throw new Error(
      "无法读取这张图片的原始生成配置，请将图片放入画布后手动选择编辑模型",
    );
  }
  return node.request;
}

/** Only prepares editable nodes; it never submits a generation or changes old nodes. */
export function createImageEditDraft(input: {
  asset: AssetView;
  source: ImageDesignSource;
  position: { x: number; y: number };
}): { nodes: CanvasNode[]; edges: CanvasEdge[]; editNodeId: string } {
  const { asset, source, position } = input;
  if (
    asset.kind !== "image" ||
    !source.provider ||
    !source.connectionId ||
    !source.model
  )
    throw new Error("缺少图片编辑所需的原始生成配置");
  const referenceId = `asset-input-${crypto.randomUUID().slice(0, 8)}`;
  const editNodeId = `image-generation-${crypto.randomUUID().slice(0, 8)}`;
  const reference: CanvasNode = {
    id: referenceId,
    type: "workflow",
    position: { ...position },
    style: { width: 300, height: 230 },
    data: {
      nodeType: "asset-input",
      label: `修改原图 · ${asset.name}`,
      description: "固定引用所选版本，保留原图",
      assetId: asset.id,
      assetKind: "image",
      outputs: [{ id: "asset", kind: "image", label: "原图" }],
    },
  };
  const edit: CanvasNode = {
    id: editNodeId,
    type: "workflow",
    position: { x: position.x + 380, y: position.y },
    style: { width: 420, height: 210 },
    data: {
      nodeType: "image-generation",
      label: "继续修改图片",
      description: "已带入保存的评审意见，核对修改要求后运行",
      provider: source.provider,
      connectionId: source.connectionId,
      model: source.model,
      parameters: { ...source.parameters, n: 1 },
      parts: [{ type: "text", text: readImageDesignReview(asset.metadata).note }],
      inputs: [
        { id: "prompt", kind: "text", label: "修改要求", required: false },
        { id: "references", kind: "image[]", label: "参考图", multiple: true },
      ],
      outputs: [{ id: "images", kind: "image", label: "图片" }],
      designSourceAssetId: asset.id,
    },
  };
  return {
    nodes: [reference, edit],
    edges: [
      {
        id: `edge-${crypto.randomUUID().slice(0, 8)}`,
        source: referenceId,
        sourceHandle: "asset",
        target: editNodeId,
        targetHandle: "references",
      },
    ],
    editNodeId,
  };
}
