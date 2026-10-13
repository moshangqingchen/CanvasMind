import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "./contracts.js";
import type { ImageEditingConnection } from "./image-editing-capabilities.js";
import { resolveImageModelContract, secureSeedreamImageContract } from "./image-model-contract.js";

function imageModel(id: string): ModelDescriptor {
  return {
    id, name: id, operations: ["image.generate", "image.edit"],
    parameters: [
      { key: "size", label: "尺寸", control: "dimensions", default: "auto", allowCustomValue: true },
      { key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] },
    ],
    pricing: { kind: "per-request", currency: "CNY", unitAmount: 0.137, checkedAt: "2026-10-10", confidence: "snapshot" },
    metadata: { sourceId: "isolated-source", priceSource: "supplier-catalog", priceStatus: "partial" },
  };
}

const scopes: { name: string; connection: ImageEditingConnection; id: string; field: string; expected: Record<string, unknown> }[] = [
  { name: "Synora fixed group quality", connection: { provider: "openai", config: {
    baseUrl: "https://synoralink.com/v1", accountKeyGroupId: "99", modelGroup: "adobe中质量生图" } },
    id: "gpt-image-2", field: "quality", expected: { default: "medium", options: [{ value: "medium", label: "medium" }] } },
  { name: "Pdog supplier pixels", connection: { provider: "openai", config: { baseUrl: "https://ai.whyshy.cn/v1" } },
    id: "gpt-image-2", field: "size", expected: { control: "dimensions", allowCustomValue: true } },
  { name: "Jiasu native resolution", connection: { provider: "rest", config: { baseUrl: "https://ai.jiasuapi.com/v1" } },
    id: "gpt-image-2.5-1k", field: "resolution", expected: { default: "1K", options: [{ value: "1K", label: "1K" }] } },
  { name: "Jijiu native tiers", connection: { provider: "openai", config: { baseUrl: "https://newapi.jijiucanvas.com/v1", modelGroup: "图片-GPT-image-2-2K/4K" } },
    id: "gpt-image-2-2K/4K", field: "size", expected: { control: "select", default: "auto", options: [
      { value: "auto", label: "自动 · 比例与像素由供应商决定" }, { value: "1K", label: "1K" }, { value: "2K", label: "2K" }, { value: "4K", label: "4K" }] } },
  { name: "Chuangxiang full SKU", connection: { provider: "openai", config: { baseUrl: "https://vapi.chuangxiangai.asia/v1", modelGroup: "生图" } },
    id: "gpt-image-2.5-flare-4k", field: "quality", expected: { default: "max" } },
  { name: "Mikoto group quality", connection: { provider: "openai", config: { baseUrl: "https://api.mikoto.vip/v1", modelGroup: "生图（2k4k 中质量）" } },
    id: "gpt-image-2", field: "quality", expected: { default: "medium", options: [{ value: "medium", label: "中" }] } },
  { name: "Secure Seedream explicit dimensions", connection: { provider: "openai", config: { baseUrl: "https://token.secure-skill.com/v1", modelGroup: "seedream-5.0-pro" } },
    id: "seedream-5.0-pro", field: "size", expected: { default: "2048x2048", min: 768, max: 2048, step: 1 } },
  { name: "Pdog Banana native tier", connection: { provider: "openai", config: { baseUrl: "https://ai.whyshy.cn/v1" } },
    id: "gemini-3.1-flash-image-preview", field: "image_size", expected: { control: "select" } },
];

describe("shared image model contract assembly", () => {
  it.each(scopes)("retains the exact $name contract, price and inputs", ({ connection, id, field, expected }) => {
    const model = imageModel(id), original = structuredClone(model), beforeConnection = structuredClone(connection);
    const resolved = resolveImageModelContract(connection, model);
    expect(resolved.parameters?.find(parameter => parameter.key === field)).toMatchObject(expected);
    expect(resolved.id).toBe(id);
    expect(resolved.pricing).toEqual(original.pricing);
    expect(resolved.metadata).toMatchObject({ sourceId: "isolated-source", priceSource: "supplier-catalog", priceStatus: "partial" });
    expect(model).toEqual(original);
    expect(connection).toEqual(beforeConnection);
    expect(resolveImageModelContract(connection, resolved)).toEqual(resolved);
  });

  it("applies existing Secure and Fri one-K constraints before restoring user presets", () => {
    const secure = resolveImageModelContract({ provider: "openai", config: {
      baseUrl: "https://token.secure-skill.com", modelGroup: "gpt-image-2.5" } }, imageModel("gpt-image-2.5-flare"));
    expect(secure.parameters?.find(parameter => parameter.key === "size")?.options?.map(option => option.value))
      .toEqual(["1024x1024", "1536x1024", "1024x1536"]);
    expect(secure.metadata?.imageSizeOptionsCompleteEnum).toBe(true);
    const fri = resolveImageModelContract({ provider: "openai", config: {
      baseUrl: "https://platform.frimodel.com", modelGroup: "codex_image" } }, imageModel("gpt-image-2-w"));
    expect(fri.metadata?.imageUserSizePresetTiers).toEqual(["1K"]);
    expect(fri.parameters?.find(parameter => parameter.key === "size")?.options?.some(option => /[24]K ·/u.test(option.label))).toBe(false);
  });

  it("does not borrow COpen rules from another origin, stable group or full model ID", () => {
    const current = scopes[0]!.connection;
    for (const config of [
      { ...current.config, accountKeyGroupId: "999" },
      { ...current.config, baseUrl: "https://synoralink.com.example/v1" },
      { ...current.config, baseUrl: "https://synoralink.com/custom" },
    ]) {
      const resolved = resolveImageModelContract({ provider: "openai", config }, imageModel("gpt-image-2"));
      expect(resolved.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("high");
      expect(resolved.metadata?.imageOpenSizePreferences).toBeUndefined();
    }
    const sibling = resolveImageModelContract(current, imageModel("gpt-image-2-other"));
    expect(sibling.metadata?.imageOpenSizePreferences).toBeUndefined();
  });

  it.each([
    { source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" },
  ])("retains explicit model evidence %j without rebuilding its controls", metadata => {
    for (const { connection, id } of scopes) {
      const model = { ...imageModel(id), metadata };
      expect(resolveImageModelContract(connection, model)).toBe(model);
    }
  });

  it("keeps manual protocol connections outside automatic contract assembly", () => {
    for (const { connection, id } of scopes) {
      const model = imageModel(id);
      expect(resolveImageModelContract({ ...connection, config: { ...connection.config, manualProtocol: true } }, model)).toBe(model);
    }
  });

  it("retains the moved Seedream field order, full pixel table and edit-only field", () => {
    const connection = scopes.find(scope => scope.id === "seedream-5.0-pro")!.connection;
    const resolved = secureSeedreamImageContract(connection, imageModel("seedream-5.0-pro"));
    expect(resolved.parameters?.map(parameter => parameter.key)).toEqual(["size", "width", "height", "n", "strength"]);
    expect(resolved.parameters?.find(parameter => parameter.key === "size")?.options).toHaveLength(22);
    expect(resolved.parameters?.find(parameter => parameter.key === "strength")?.operations).toEqual(["image.edit"]);
    expect(resolved.parameters?.some(parameter => parameter.key === "quality")).toBe(false);
  });
});
