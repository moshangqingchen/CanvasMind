import { expect, it } from "vitest";
import { distinctAssetSources } from "./asset-preparation-cache.js";

const asset = { id: "same", kind: "image" as const, mimeType: "image/png", data: new Uint8Array([1, 2, 3]) };
it("lists one source per identity without changing role entries or their order", () => {
  const assets = [{ ...asset, role: "lastFrame" as const }, { ...asset, data: new Uint8Array(asset.data), role: "firstFrame" as const }];
  expect(distinctAssetSources(assets)).toEqual([assets[0]]);
  expect(assets.map(value => value.role)).toEqual(["lastFrame", "firstFrame"]);
});
it("does not silently reuse a conflicting original under the same identity", () => {
  for (const changed of [{ ...asset, data: new Uint8Array([3, 2, 1]) }, { ...asset, mimeType: "image/webp" },
    { ...asset, url: "https://cdn.test/changed.png" }])
    expect(() => distinctAssetSources([asset, changed])).toThrow("同一素材身份包含不同原文件");
});
