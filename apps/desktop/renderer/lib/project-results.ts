import type { AssetView } from "../components/types";

export interface ProjectResult {
  assetId: string;
  canvasId: string;
  runId: string;
  nodeId: string;
  label: string;
  sourceAssetId?: string;
  instruction: string;
  requirements: string;
}

/** Use the frozen run graph, not the node's current contents. */
export function projectResultContext(
  graph: unknown,
  nodeId: string,
  includeText = true,
) {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const nodes = record(graph).nodes;
  const node = Array.isArray(nodes)
    ? nodes.find((value) => record(value).id === nodeId)
    : undefined;
  const data = record(record(node).data);
  const brief = record(data.graphicDesignBrief);
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const instruction = includeText
    ? parts
        .filter((part) => record(part).type === "text")
        .map((part) =>
          typeof record(part).text === "string" ? record(part).text : "",
        )
        .join("\n")
    : "";
  const requirements = includeText
    ? [
        ...[
          "customerText",
          "headline",
          "subheadline",
          "body",
          "eventDate",
          "location",
          "callToAction",
          "brandName",
          "brandColors",
          "style",
          "constraints",
        ].flatMap((key) =>
          typeof brief[key] === "string" && brief[key] ? [brief[key]] : [],
        ),
        ...(Array.isArray(brief.customerImages)
          ? brief.customerImages.flatMap((image) =>
              typeof record(image).text === "string"
                ? [record(image).text]
                : [],
            )
          : []),
      ].join("\n")
    : "";
  const sourceReference = Array.isArray(brief.references)
    ? brief.references.find((value) => record(value).role === "source")
    : undefined;
  const source = data.designSourceAssetId ?? record(sourceReference).assetId;
  return {
    label: typeof data.label === "string" ? data.label.slice(0, 160) : nodeId,
    ...(typeof source === "string" && source ? { sourceAssetId: source } : {}),
    instruction,
    requirements,
  };
}

/** Explicit edit ancestry and repeated outputs from the same node share a family. */
export function projectResultFamilies(
  results: readonly ProjectResult[],
): Map<string, string> {
  const byAsset = new Map(results.map((result) => [result.assetId, result]));
  const families = new Map<string, string>();
  for (const result of results) {
    let current = result;
    const seen = new Set<string>();
    while (
      current.sourceAssetId &&
      byAsset.has(current.sourceAssetId) &&
      !seen.has(current.assetId)
    ) {
      seen.add(current.assetId);
      current = byAsset.get(current.sourceAssetId)!;
    }
    const root = seen.has(current.assetId)
      ? `cycle:${[...seen].sort()[0]}`
      : current.sourceAssetId
        ? `asset:${current.sourceAssetId}`
        : `node:${current.canvasId}:${current.nodeId}`;
    families.set(result.assetId, root);
  }
  return families;
}

export function imageResultVersions(
  assetId: string,
  assets: readonly AssetView[],
  results: readonly ProjectResult[],
): AssetView[] {
  const families = projectResultFamilies(results);
  const family = families.get(assetId);
  return assets
    .filter(
      (asset) =>
        asset.id === assetId || (family && families.get(asset.id) === family),
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
}
