import type { FetchImplementation, NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { assetToBlob } from "./http.js";
import { isJijiuWanVideoModel } from "./jijiu-video-contract.js";

/** Server-only download/byte preparation; browser contract modules stay pure. */
export async function prepareJijiuWanFiles(request: NormalizedRequest, fetchImpl: FetchImplementation): Promise<NormalizedRequest> {
  if (!isJijiuWanVideoModel(request.model)) return request;
  const parameters = { ...request.parameters };
  for (const field of ["images", "videos", "audios"] as const) {
    const raw = parameters[field];
    const values = raw === undefined || raw === "" ? [] : Array.isArray(raw) ? raw : [raw];
    if (!values.length) continue;
    parameters[field] = await Promise.all(values.map(async value => {
      const asset = value as ProviderAssetInput;
      const blob = await assetToBlob(asset, fetchImpl);
      return { ...asset, data: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || asset.mimeType };
    }));
  }
  return { ...request, parameters };
}
