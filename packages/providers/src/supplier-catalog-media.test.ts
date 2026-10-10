import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSupplierCatalog } from "./supplier-catalog.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/jijiu-billing-20261010.json", import.meta.url), "utf8")) as {
  group_ratio: Record<string, number>;
  data: Array<{ model_name: string; tags: string; supported_endpoint_types: string[]; enable_groups: string[] }>;
};
const payload = { ...fixture, usable_group: Object.fromEntries(Object.keys(fixture.group_ratio).map(id => [id, id])) };
const source = { supplierSiteUrl: "https://newapi.jijiucanvas.com", checkedAt: "2026-10-10T08:00:00Z" };
const network = vi.fn(() => { throw new Error("Unexpected HTTP in offline catalog regression"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("official media categories and protocol selection", () => {
  it("preserves all 33 exact official model IDs, categories and group memberships", () => {
    const catalog = parseSupplierCatalog(payload, source);
    expect(catalog).toMatchObject({ recognized: true, kind: "newapi" });
    const models = new Map(catalog.groups.flatMap(group => group.models.map(model => [model.id, model] as const)));
    expect([...models.keys()].sort()).toEqual(fixture.data.map(row => row.model_name).sort());
    expect([...models.values()].filter(model => model.capability === "image")).toHaveLength(7);
    expect([...models.values()].filter(model => model.capability === "video")).toHaveLength(18);
    expect([...models.values()].filter(model => model.capability === "chat")).toHaveLength(8);
    for (const row of fixture.data) {
      const capability = row.tags === "图片模型" ? "image" : row.tags === "视频模型" ? "video" : "chat";
      expect(models.get(row.model_name)?.capability, row.model_name).toBe(capability);
      expect(catalog.groups.filter(group => group.models.some(model => model.id === row.model_name)).map(group => group.id).sort(), row.model_name)
        .toEqual([...row.enable_groups].sort());
    }
    for (const group of catalog.groups) {
      expect(group.models.map(model => model.id).sort(), group.id).toEqual(fixture.data.filter(row => row.enable_groups.includes(group.id)).map(row => row.model_name).sort());
    }
  });
  it("selects specific image transport ahead of advertised chat/Gemini alternatives", () => {
    const catalog = parseSupplierCatalog(payload, source);
    const models = catalog.groups.flatMap(group => group.models);
    for (const id of ["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst", "gpt-image-2-2K/4K"]) {
      expect(models.find(model => model.id === id)).toMatchObject({ capability: "image", protocol: "openai-images" });
    }
    for (const id of ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-nano-banana-2.1"]) {
      expect(models.find(model => model.id === id)).toMatchObject({ capability: "image", protocol: "gemini" });
    }
    for (const model of models.filter(model => model.capability === "video")) {
      expect(model.protocol, model.id).toBe("openai-videos");
      expect(model.metadata?.parameterSource, model.id).toBe("supplier-documented-contract");
    }
  });
  it("does not turn understanding tags, generic protocols, input kinds or billing schemas into generation", () => {
    const models = parseSupplierCatalog({ data: [
      { id: "opaque-chat", tags: "语言模型", input_modalities: ["image", "video"], supported_endpoint_types: ["openai", "gemini"] },
      { id: "opaque-understanding", tags: ["视频理解", "图像输入"], supported_endpoint_types: ["openai"] },
      { id: "opaque-text", tags: "视频模型", output_modalities: ["text"], supported_endpoint_types: ["openai-video"] },
      { id: "opaque-explicit-chat", tags: "图片模型", capability: "chat", supported_endpoint_types: ["image-generation"] },
      { id: "opaque-billing", billing_usage_schema: { images: { type: "number" }, seconds: { type: "number" } } },
    ] }).groups[0]!.models;
    expect(models.map(model => model.capability)).toEqual(["chat", "other", "chat", "chat", "other"]);
    expect(models.every(model => !["openai-images", "openai-videos"].includes(model.protocol ?? ""))).toBe(true);
  });
  it("keeps declared endpoint classifications through serialized and native directory shapes", () => {
    const models = parseSupplierCatalog({ data: [
      { id: "opaque-image", metadata: { endpointTypes: ["image-generation", "gemini"] } },
      { id: "opaque-video", endpointTypes: ["openai", "openai-video"] },
      { id: "opaque-protocol", protocol: "openai-video" },
    ] }).groups[0]!.models;
    expect(models.map(model => [model.id, model.capability, model.protocol])).toEqual([
      ["opaque-image", "image", "openai-images"], ["opaque-video", "video", "openai-videos"], ["opaque-protocol", "video", "openai-videos"],
    ]);
    expect(parseSupplierCatalog({ data: models }).groups[0]?.models.map(model => [model.id, model.capability, model.protocol]))
      .toEqual(models.map(model => [model.id, model.capability, model.protocol]));
  });
  it("requires the exact supplier and known group ratio for native video and prices", () => {
    const id = "SD2.0fast稳定903A";
    const current = parseSupplierCatalog(payload, source).groups;
    expect(current.find(group => group.id === "视频SD2.0")?.models.find(model => model.id === id)?.metadata?.officialCatalogPriceGroupVerified).toBe(true);
    const inaccessible = current.find(group => group.id === "vip")?.models.find(model => model.id === id);
    expect(inaccessible).toMatchObject({ priceLabel: "价格条件待确认", metadata: { jijiuCatalogPricingIncomplete: true } });
    expect(inaccessible?.metadata?.officialCatalogPricing).toBeUndefined();
    const unrelated = parseSupplierCatalog(payload, { supplierSiteUrl: "https://unrelated.example" }).groups.flatMap(group => group.models);
    expect(unrelated.every(model => !model.metadata?.jijiuCatalogPricingEvidence && model.metadata?.videoContractSupplier !== "jijiu")).toBe(true);
  });
});
