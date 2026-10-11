import { describe, expect, it } from "vitest";
import { scanProviderModelCatalog } from "@super-canvas/providers";
import { mergeMonsterNativeImageCatalog, monsterNativeImageCatalogUrl } from "./monster-native-image-catalog";

const origin = "https://api.eaheng.com";
const v1Ids = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview", "gemini-nano-banana-2.1"];
const primary = () => scanProviderModelCatalog({ data: v1Ids.map(id => ({ id })) }, { baseUrl: origin });
const native = (ids: string[]) => ({ models: ids.map(id => ({ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] })) });

describe("Monster C1 exact generic/native Key inventory union", () => {
  it("does not manufacture a historical alias or website-only lite from a three-ID Key read", () => {
    const merged = mergeMonsterNativeImageCatalog(primary(), native(v1Ids), "", origin);
    expect(merged.models.map(model => model.id)).toEqual(v1Ids);
    expect(merged.models.some(model => model.id === "nano-banana-2.1" || model.id === "gemini-3.1-flash-lite-image")).toBe(false);
  });

  it("keeps the fourth exact alias when the authenticated native directory really returns it", () => {
    const nativeIds = [...v1Ids, "nano-banana-2.1"];
    const merged = mergeMonsterNativeImageCatalog(primary(), native(nativeIds), "", origin);
    expect(merged.models.map(model => model.id)).toEqual(nativeIds);
    const alias = merged.models.find(model => model.id === "nano-banana-2.1")!;
    expect(alias.metadata).toMatchObject({ operationsSource: "native-key-directory",
      monsterNativeModelName: "models/nano-banana-2.1", monsterNativeCatalogSource: `${origin}/v1beta/models`,
      nativeImageModelName: "models/nano-banana-2.1", nativeImageCatalogSource: `${origin}/v1beta/models` });
    expect(alias.metadata?.monsterNativeCatalogCheckedAt).toBe(merged.checkedAt);
    expect(alias.metadata?.nativeImageCatalogCheckedAt).toBe(merged.checkedAt);
    expect(merged.groups.flatMap(group => group.modelIds)).toContain("nano-banana-2.1");
  });

  it("removes transport wrappers only and requires actual generateContent support", () => {
    const payload = { models: [
      { name: "models/gemini-3.1-flash-lite-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/nano-banana-2.1", supportedGenerationMethods: ["embedContent"] },
      { name: "models/not-declared-for-generation" },
    ] };
    const merged = mergeMonsterNativeImageCatalog(primary(), payload, "", origin);
    expect(merged.models.map(model => model.id)).toEqual([...v1Ids, "gemini-3.1-flash-lite-image"]);
    expect(merged.models.find(model => model.id === "gemini-3.1-flash-lite-image")?.metadata?.monsterNativeModelName)
      .toBe("models/gemini-3.1-flash-lite-image");
  });

  it("keeps this native inventory request scoped to the exact supplier and stable C1 group", () => {
    expect(monsterNativeImageCatalogUrl({ baseUrl: `${origin}/v1`, accountKeyGroupId: "11", accountKeyGroup: "renamed-C1" }))
      .toBe(`${origin}/v1beta/models`);
    expect(monsterNativeImageCatalogUrl({ baseUrl: origin, accountKeyGroupId: "12", accountKeyGroup: "C1-Gemini（香蕉生图）" })).toBeUndefined();
    expect(monsterNativeImageCatalogUrl({ baseUrl: "https://genimage.pro/v1", accountKeyGroupId: "11" })).toBeUndefined();
  });
});
