import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets, userImageSizeOptions } from "@super-canvas/providers/image-size-presets";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import { nativeImageResolutionControl } from "./native-image-resolution";
import { normalizedParametersForModel, setParameterValue } from "./model-parameters";
import { modelEstimatedCost } from "./model-display";
import { NodeParameterFields, setParameterValueWithSizeExclusivity } from "../components/node-parameter-fields";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

const fixture = JSON.parse(readFileSync(new URL("./fixtures/mikoto-installed-r4-one-k-safe.json", import.meta.url), "utf8")) as {
  rows: { context: { sourceId: string; officialGroupId: string }; connection: {
    id: string; provider: string; config: Readonly<Record<string, unknown>>;
  }; model: ModelDescriptor }[];
};
const supplier = { id: "supplier-85a8c80adddefe307e2fc6fa", siteUrl: "https://api.mikoto.vip", apiUrl: "https://api.mikoto.vip",
  updatedAt: "2026-10-11T04:48:13.488Z", scannedAt: "2026-10-11T04:48:13.488Z",
  state: { sourceId: "f17ed5f5-9b8f-47d9-a621-0bbe4bfb9e15" }, catalog: { groups: [] } } as unknown as SupplierRecord;
const samples = ["1024x1024", "1360x768", "768x1360", "1184x880", "880x1184", "1248x832", "832x1248",
  "1136x912", "912x1136", "1552x672", "672x1552"];
const enrich = (row: typeof fixture.rows[number], model = row.model) => effectiveImageCapabilities({
  supplier, connection: row.connection, model, fingerprint: "r4-g5-safe-fixture",
}).model;

describe("Mikoto group5 exact source controls and accepted highest input", () => {
  it.each(fixture.rows)("repairs cached $model.id open dimensions without unpublished bounds", row => {
    const before = structuredClone(row.model);
    const model = enrich(row);
    const size = model.parameters?.find(p => p.key === "size");
    expect(size).toMatchObject({ control: "dimensions", step: 1, allowCustomValue: true });
    expect(size?.min).toBeUndefined();
    expect(size?.max).toBeUndefined();
    expect(size?.description).not.toMatch(/16.*对齐|256|3840.*上限/u);
    expect(model.pricing).toEqual(row.model.pricing);
    expect(model.metadata?.supplierPriceGroupId).toBe("5");
    expect(row.model).toEqual(before);
  });
  it.each(fixture.rows)("gives $model.id all user preset tiers without claiming matching output pixels", row => {
    const model = enrich(row);
    const native = nativeImageResolutionControl(model.parameters ?? [], model);
    expect(native?.resolution.key).toBe("size_tier");
    expect(native?.resolution.options?.map(o => o.value)).toEqual(["1K", "2K", "4K"]);
    expect(model.metadata?.imageObservedOutputDimensions).toMatchObject({ width: 1672, height: 941,
      requestedWidth: 3840, requestedHeight: 2160 });
    const selected = Object.freeze({ size_tier: "1K", size: "4097x2051", quality: "high", aspect_ratio: "auto" });
    const html = renderToStaticMarkup(React.createElement(NodeParameterFields, { nodeId: "mikoto-g5", nodeType: "image-generation",
      provider: "rest", model, parameters: selected, onChange: vi.fn() }));
    expect(html).toMatch(/<button(?=[^>]*aria-pressed="true")[^>]*><span>1K<\/span><\/button>/u);
    expect(html).toContain("><span>2K</span></button>");
    expect(html).toContain("><span>4K</span></button>");
    expect(html).toMatch(/<input(?=[^>]*aria-label="图片宽度")(?=[^>]*value="4097")[^>]*>/u);
    expect(html).toMatch(/<input(?=[^>]*aria-label="图片高度")(?=[^>]*value="2051")[^>]*>/u);
    expect(html).not.toMatch(/max="3840"|min="256"|step="16"|16 倍数对齐/u);
    expect(normalizedParametersForModel("image-generation", "rest", model, selected)).toMatchObject(selected);
    expect(setParameterValue(selected, "aspect_ratio", "2:1", model)).toMatchObject({
      size: "4097x2051", size_tier: "1K", quality: "high", aspect_ratio: "2:1",
    });
  });
  it("retains Flare's historical request values within explicitly marked user presets", () => {
    const row = fixture.rows.find(row => row.model.id === "gpt-image-2.5-flare")!;
    const model = enrich(row);
    expect(model.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(userImageSizeOptions().map(o => o.value));
    expect(model.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(expect.arrayContaining(samples));
    expect(model.metadata?.imageSizeSourceKind).toBe("user-request");
    expect(model.metadata?.imageResolutionTierSource).toBe("user-presets+same-group-accepted-4K-input");
    expect(model.metadata?.imageSizeOptionsCompleteEnum).toBeUndefined();
    expect(model.metadata?.imageAspectRatiosVerifiedAt).toBe("2026-09-13");
    expect(model.parameters?.find(p => p.key === "size")?.allowCustomValue).toBe(true);
  });
  it("labels Sunburst dimensions as user presets and does not borrow Flare's ratio verification", () => {
    const row = fixture.rows.find(row => row.model.id === "gpt-image-2.5-sunburst")!;
    const model = enrich(row);
    expect(model.parameters?.find(p => p.key === "size")?.options?.map(o => o.value)).toEqual(userImageSizeOptions().map(o => o.value));
    expect(model.metadata?.imageResolutionTierSource).toBe("user-presets+same-group-accepted-4K-input");
    expect(model.metadata?.imageAspectRatiosVerifiedAt).toBeUndefined();
    expect(model.metadata?.imageSizeSourceKind).toBe("user-request");
    expect(model.metadata?.imageSizeOptionsCompleteEnum).toBeUndefined();
  });
  it("selects a historical approximate Flare size without injecting or deleting a ratio preference", () => {
    const row = fixture.rows.find(row => row.model.id === "gpt-image-2.5-flare")!;
    const model = enrich(row);
    const option = model.parameters?.find(p => p.key === "size")?.options?.find(o => o.value === "1184x880");
    expect(option?.label).toBe("1K · 4:3 · 1184 × 880");
    expect(model.metadata?.imageSizeSourceKind).toBe("user-request");
    const context = { hasSizeControl: true, hasAspectRatioControl: true, model };
    const automatic = { size: "auto", size_tier: "1K", aspect_ratio: "auto", quality: "high" };
    expect(setParameterValueWithSizeExclusivity(automatic, "size", "1184x880", context)).toEqual({
      ...automatic, size: "1184x880",
    });
    const explicit = { ...automatic, aspect_ratio: "16:9" };
    const selected = setParameterValueWithSizeExclusivity(explicit, "size", "1184x880", context);
    expect(selected).toEqual({ ...explicit, size: "1184x880" });
    expect(modelEstimatedCost(model, selected)).toBeUndefined();
  });
  it.each(fixture.rows)("keeps $model.id highest max preset, exact .02 USD price and explicit saved values", row => {
    const model = enrich(row);
    expect(model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "max",
      options: ["auto", "low", "medium", "high", "xhigh", "max"].map(value => ({ value })) });
    const choice = Object.freeze({ size: "2051x2049", size_tier: "1K", quality: "auto", aspect_ratio: "1:1" });
    const reloaded = JSON.parse(JSON.stringify(normalizedParametersForModel("image-generation", "rest", model, choice)));
    expect(reloaded).toMatchObject(choice);
    expect(modelEstimatedCost(model, { ...choice, n: 1 })).toBe("0.02 USD");
    expect(modelEstimatedCost(model, { ...choice, aspect_ratio: "16:9", n: 1 })).toBeUndefined();
    expect(enrich(row, model)).toEqual(model);
  });
  it.each(fixture.rows)("binds live $model.id and its cached connector to the same source contract", row => {
    const bound = bindScannedModelProtocols(row.connection, [row.model]);
    const cached = applyUserImageSizePresets(enrich(row, bound.models[0]!));
    expect(bound.models[0]?.parameters).toEqual(cached.parameters);
    expect(bound.models[0]?.pricing).toEqual(cached.pricing);
    const size = bound.models[0]?.parameters?.find(p => p.key === "size");
    expect(size).toMatchObject({ step: 1, allowCustomValue: true });
    expect(size?.min).toBeUndefined();
    expect(size?.max).toBeUndefined();
    // This public UI receipt omits the transport template. The separate exact
    // whole-connection fixture checks connector/template persistence.
    expect(bound.connector).toBeUndefined();
  });
});
