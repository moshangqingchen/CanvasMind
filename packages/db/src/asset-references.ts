/** Pure, browser-safe reference traversal shared by save and rollback cleanup. */
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function addAssetId(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim()) target.add(value);
}

function addAssetIds(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) addAssetId(target, item);
}

/** Returns only durable asset references stored in a serialized graph. */
export function collectReferencedAssetIds(graph: unknown): string[] {
  const ids = new Set<string>();
  const nodes = isRecord(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    const data = isRecord(node) && isRecord(node.data) ? node.data : undefined;
    addAssetId(ids, data?.assetId);
    addAssetId(ids, data?.designSourceAssetId);
    for (const parameters of [data?.parameters, data?.generatedParameters]) {
      if (!isRecord(parameters)) continue;
      addAssetId(ids, parameters.maskAssetId);
      addAssetId(ids, parameters.maskSourceAssetId);
    }
    if (isRecord(data?.generatedDetails)) {
      const details = data.generatedDetails;
      if (isRecord(details.imageMask)) {
        addAssetId(ids, details.imageMask.maskAssetId);
        addAssetId(ids, details.imageMask.maskSourceAssetId);
      }
      addAssetIds(ids, details.inputAssetIds);
      if (Array.isArray(details.inputAssets)) for (const asset of details.inputAssets)
        if (isRecord(asset)) addAssetId(ids, asset.id);
    }
    addAssetIds(ids, data?.lastOutputAssetIds);
    addAssetIds(ids, data?.materializedOutputAssetIds);
    if (isRecord(data?.graphicDesignBrief)) {
      const brief = data.graphicDesignBrief;
      addAssetIds(ids, brief.customerImageAssetIds);
      for (const key of ["references", "customerImages"]) {
        if (Array.isArray(brief[key])) {
          for (const image of brief[key]) {
            if (isRecord(image)) addAssetId(ids, image.assetId);
          }
        }
      }
    }
    // `prompt` is a durable legacy alias still consumed by runtime.
    for (const parts of [data?.parts, data?.prompt, data?.generatedPromptParts]) {
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (isRecord(part) && part.type === "asset") addAssetId(ids, part.assetId);
      }
    }
  }
  return [...ids].sort();
}
