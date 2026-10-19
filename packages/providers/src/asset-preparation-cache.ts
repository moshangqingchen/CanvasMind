import type { ProviderAssetInput } from "./contracts.js";
import { MaterialPreparationError } from "./material-preparation.js";

/** Per-call identity reuse; roles/order belong to the original array, not this list. */
export function distinctAssetSources(assets: readonly ProviderAssetInput[]): ProviderAssetInput[] {
  const unique = new Map<string, ProviderAssetInput>();
  for (const asset of assets) {
    const previous = unique.get(asset.id);
    if (!previous) { unique.set(asset.id, asset); continue; }
    const sameBytes = previous.data === asset.data || Boolean(previous.data && asset.data &&
      previous.data.byteLength === asset.data.byteLength && previous.data.every((byte, index) => byte === asset.data![index]));
    if (previous.kind !== asset.kind || previous.mimeType !== asset.mimeType || previous.url !== asset.url || !sameBytes)
      throw new MaterialPreparationError("read", { detail: "同一素材身份包含不同原文件，已停止准备" });
  }
  return [...unique.values()];
}
