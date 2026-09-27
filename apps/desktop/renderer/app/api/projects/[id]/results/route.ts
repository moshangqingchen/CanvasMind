import {
  jsonError,
  repository,
  redactPublicText,
} from "../../../../../lib/server";
import {
  projectResultContext,
  type ProjectResult,
} from "../../../../../lib/project-results";
import { collectReferencedAssetIds } from "../../../../../lib/project-transfer";
import type { CanvasDocument } from "../../../../../components/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const selectedAssetId = new URL(request.url).searchParams.get("assetId");
  const canvas = await repository.getCanvas(id);
  if (!canvas) return jsonError("项目不存在", 404);
  const results: ProjectResult[] = [];
  const assets = new Map(
    (await repository.listAssets()).map((asset) => [asset.id, asset]),
  );
  for (const run of await repository.listRuns(id)) {
    for (const node of await repository.listNodeRuns(run.id)) {
      if (!node.outputAssetIds.length) continue;
      if (selectedAssetId && !node.outputAssetIds.includes(selectedAssetId))
        continue;
      const source = projectResultContext(
        run.revisionGraph,
        node.nodeId,
        Boolean(selectedAssetId),
      );
      for (const assetId of node.outputAssetIds) {
        if (selectedAssetId && assetId !== selectedAssetId) continue;
        const asset = assets.get(assetId);
        if (
          !asset ||
          asset.deleted ||
          asset.metadata.runId !== run.id ||
          asset.metadata.nodeId !== node.nodeId
        )
          continue;
        results.push({
          assetId,
          canvasId: id,
          runId: run.id,
          nodeId: node.nodeId,
          ...source,
          instruction: selectedAssetId
            ? redactPublicText(
                typeof node.inputJson.prompt === "string"
                  ? node.inputJson.prompt
                  : source.instruction,
              )
            : "",
          requirements: redactPublicText(source.requirements),
        });
      }
    }
  }
  const graph = canvas.graph as unknown as CanvasDocument;
  const known = new Set(results.map((result) => result.assetId));
  for (const asset of assets.values()) {
    if (selectedAssetId && asset.id !== selectedAssetId) continue;
    if (
      known.has(asset.id) ||
      asset.deleted ||
      asset.metadata.canvasId !== id ||
      typeof asset.metadata.runId !== "string"
    )
      continue;
    results.push({
      assetId: asset.id,
      canvasId: id,
      runId: asset.metadata.runId,
      nodeId:
        typeof asset.metadata.nodeId === "string"
          ? asset.metadata.nodeId
          : asset.id,
      label:
        typeof asset.metadata.designNodeLabel === "string"
          ? asset.metadata.designNodeLabel
          : asset.name,
      ...(typeof asset.metadata.designSourceAssetId === "string"
        ? { sourceAssetId: asset.metadata.designSourceAssetId }
        : {}),
      instruction: "",
      requirements: "",
    });
    known.add(asset.id);
  }
  for (const assetId of collectReferencedAssetIds(graph)) {
    if (selectedAssetId && assetId !== selectedAssetId) continue;
    if (known.has(assetId)) continue;
    const asset = assets.get(assetId);
    if (
      !asset ||
      asset.deleted ||
      asset.kind !== "image" ||
      !asset.metadata.imageDesignReview
    )
      continue;
    const node =
      graph.nodes.find((node) =>
        node.data.lastOutputAssetIds?.includes(assetId),
      ) ?? graph.nodes.find((node) => node.data.assetId === assetId);
    if (!node) continue;
    const sourceNodeId =
      typeof node.data.generatedFromNodeId === "string"
        ? node.data.generatedFromNodeId
        : node.id;
    const context = projectResultContext(
      graph,
      sourceNodeId,
      Boolean(selectedAssetId),
    );
    results.push({
      assetId,
      canvasId: id,
      runId: "",
      nodeId: sourceNodeId,
      ...context,
      instruction: redactPublicText(context.instruction),
      requirements: redactPublicText(context.requirements),
    });
  }
  return Response.json(results);
}
