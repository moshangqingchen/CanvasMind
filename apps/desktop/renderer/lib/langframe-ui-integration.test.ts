import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { langframeModelsForKey, langframeParameters, parseLangframeCatalog, type ModelDescriptor } from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { normalizedParametersForModel, parameterDescriptorsFor, parametersWithDefaults } from "./model-parameters";
import { cleanModelDisplayName, currentSupplierUnitPrice, modelEstimatedQuote, modelPriceSummary } from "./model-display";
import { modelPickerPriceCompact } from "./model-picker-data";
import { providerConnectionGroup, providerConnectionGroupDisplayLabel } from "./provider-connection-options";
import { choosePickerConnection, pickerConnectionGroups } from "./model-picker";
import type { ProviderConnectionView } from "./client-api";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/langframe-catalog-20261018.json", import.meta.url), "utf8")) as {
  checkedAt: string; sha256: string; payload: unknown;
};
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const catalog = parseLangframeCatalog(fixture.payload, { checkedAt: fixture.checkedAt, sourceSha256: fixture.sha256 });
const savedGroups = json(catalog.groups);
const connection = { provider: "langframe", config: { baseUrl: "https://vipprompt.cn", usage: "canvas", modelScanStatus: "live", modelScanComplete: true,
  scannedModelIds: catalog.models.map(model => model.id), modelCatalogModels: json(langframeModelsForKey(savedGroups, [], [])) } };
const bind = (models: readonly ModelDescriptor[] = connection.config.modelCatalogModels) => bindScannedModelProtocols(connection, json(models)).models;
const model = (name: string) => bind().find(model => model.id === name)!;
const imageId = "image-2.5-flare-1K-2k-4kMAX品质";
const noNetwork = vi.fn(() => Promise.reject(new Error("UI catalog integration must not contact a supplier")));

beforeAll(() => { vi.stubGlobal("fetch", noNetwork); vi.stubGlobal("React", React); });
afterAll(() => { expect(noNetwork).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("狼帧 public catalog → saved descriptors → real UI binding and normalization", () => {
  it("restores the latest two calls, exact category tariffs and X/C 5–30 controls after saved catalog reload", () => {
    const current = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/langframe-catalog-20261021.json", import.meta.url), "utf8"));
    const parsed = parseLangframeCatalog(current.payload, { checkedAt: current.checkedAt, sourceSha256: current.sha256 });
    const fresh = json(langframeModelsForKey(json(parsed.groups), [], []));
    const liveConnection = { ...connection, config: { ...connection.config, scannedModelIds: fresh.map(m => m.id), modelCatalogModels: fresh } };
    const bound = bindScannedModelProtocols(liveConnection, json(fresh)).models;
    for (const [id, resolution, price] of [["kling-v4-VIP-支持真人", "720P", .399], ["SD-2.5-S支持真人满血", "480P", .49]] as const) {
      const selected = bound.find(m => m.id === id)!;
      const controls = parameterDescriptorsFor("video-generation", "langframe", selected);
      const saved = { resolution, duration: 5, ratio: "16:9" };
      expect(normalizedParametersForModel("video-generation", "langframe", selected, json(parametersWithDefaults(controls, saved)))).toMatchObject(saved);
      expect(currentSupplierUnitPrice(selected, saved)).toContain(String(price));
    }
    for (const id of ["SD2.5-X-满参支持人脸", "SD2.5-C-满参支持人脸"]) {
      const selected = bound.find(m => m.id === id)!;
      expect(parameterDescriptorsFor("video-generation", "langframe", selected).find(p => p.key === "duration")?.options?.map(o => o.value)).toEqual(Array.from({ length: 26 }, (_, i) => i + 5));
      expect(normalizedParametersForModel("video-generation", "langframe", selected, { resolution: "720P", duration: 4 })).toMatchObject({ duration: 4 });
    }
  });
  it("keeps complete call names, declared media kinds, raw stats and 8 independent chat tariffs after save/reload", () => {
    const bound = bind();
    expect(savedGroups).toHaveLength(39);
    expect(bound).toHaveLength(40);
    expect(bound.filter(model => model.outputKinds?.includes("image"))).toHaveLength(12);
    expect(bound.filter(model => model.outputKinds?.includes("video"))).toHaveLength(27);
    expect(bind(json(bound)).map(model => model.id)).toEqual(bound.map(model => model.id));
    expect(bound.find(model => model.id === "gpt-image-2")).toBeUndefined();
    expect(bound.find(model => model.id === "11111")).toMatchObject({ operations: ["video.generate", "video.image-to-video"] });
    const chat = bound.find(model => model.id === "gpt-5.6-sol")!;
    expect(chat.pricing).toBeUndefined();
    expect(chat.metadata?.langframeGroupCatalog).toHaveLength(8);
    expect(bound.find(model => model.id === "11111")?.metadata?.langframeRuntimeStats)
      .toEqual(catalog.models.find(model => model.id === "11111")?.metadata?.langframeRuntimeStats);
  });

  it.each(["2K", "4K"])("retains saved independent %s resolution and max quality through UI defaults, normalization and reload", resolution => {
    const selected = model(imageId), original = { resolution, size: "auto", aspect_ratio: "16:9", quality: "max" }, before = json(original);
    const withDefaults = parametersWithDefaults(parameterDescriptorsFor("image-generation", "langframe", selected), original, true);
    expect(withDefaults).toMatchObject({ resolution, size_tier: resolution, quality: "max" });
    const normalized = normalizedParametersForModel("image-generation", "langframe", selected, original);
    expect(normalized).toMatchObject({ resolution, size_tier: resolution, size: "auto", quality: "max", aspect_ratio: "16:9" });
    const reloaded = bind(json([selected]))[0]!;
    expect(normalizedParametersForModel("image-generation", "langframe", reloaded, json(normalized))).toEqual(normalized);
    expect(original).toEqual(before);
    expect(langframeParameters({ connectionId: "langframe-key-scope", operation: "image.generate", model: selected.id, prompt: "offline contract", idempotencyKey: "no-submit", parameters: normalized }))
      .toMatchObject({ resolution, quality: "max", aspect_ratio: "16:9" });
  });

  it("retains arbitrary W/H and chosen resolution without fabricating pixel restrictions or lowering quality", () => {
    const selected = model(imageId), saved = { resolution: "2K", width: 3501, height: 2301, quality: "max", aspect_ratio: "3:2" };
    const normalized = normalizedParametersForModel("image-generation", "langframe", selected, json(saved));
    expect(normalized).toMatchObject({ ...saved, size_tier: "2K" });
    const size = selected.parameters?.find(parameter => parameter.key === "size");
    expect(size).toBeDefined();
    expect(size?.control).toBe("dimensions");
    expect(size?.min).toBeUndefined();
    expect(size?.max).toBeUndefined();
    expect(size?.step).toBeUndefined();
    const wire = langframeParameters({ connectionId: "langframe-key-scope", operation: "image.edit", model: selected.id,
      prompt: "offline contract", idempotencyKey: "no-submit", parameters: normalized });
    expect(wire).toMatchObject({ resolution: "2K", size: "3501x2301", quality: "max", aspect_ratio: "3:2" });
    expect(wire).not.toHaveProperty("width");
    expect(wire).not.toHaveProperty("height");
  });

  it("keeps all 13 declared ratios and the exact 5-ratio Qwen enum in actual parameter controls", () => {
    const selected = model(imageId), controls = parameterDescriptorsFor("image-generation", "langframe", selected);
    expect(controls.find(parameter => parameter.key === "aspect_ratio")?.options).toHaveLength(13);
    expect(controls.find(parameter => parameter.key === "size")?.options).toHaveLength(40);
    for (const [ratio, size] of [["1:2", "1920x3840"], ["2:1", "3840x1920"]]) {
      expect(controls.find(parameter => parameter.key === "size")?.options?.some(option => option.value === size && option.label.startsWith(`4K · ${ratio} ·`))).toBe(true);
      const restored = normalizedParametersForModel("image-generation", "langframe", selected, { resolution: "4K", size, aspect_ratio: ratio, quality: "max" });
      expect(restored).toMatchObject({ resolution: "4K", size_tier: "4K", size, aspect_ratio: ratio, quality: "max" });
    }
    const qwen = model("qwen-image-3.0"), qwenControls = parameterDescriptorsFor("image-generation", "langframe", qwen);
    expect(qwenControls.find(parameter => parameter.key === "aspect_ratio")?.options?.map(option => option.value)).toEqual(["1:1", "16:9", "9:16", "3:4", "4:3"]);
    expect(qwenControls.find(parameter => parameter.key === "size")?.options).toHaveLength(6);
    expect(qwenControls.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(["2K"]);
  });

  it("identifies downstream Image 2.5/2 quality defaults without borrowing the shared inner ID for Qwen", () => {
    expect(model(imageId).parameters?.find(parameter => parameter.key === "quality")?.default).toBe("max");
    expect(model("image-2-1K 0.04").parameters?.find(parameter => parameter.key === "quality")?.default).toBe("high");
    expect(model("qwen-image-3.0").parameters?.find(parameter => parameter.key === "quality")?.default).toBeUndefined();
    expect(normalizedParametersForModel("image-generation", "langframe", model(imageId), { resolution: "2K", quality: "low" })).toMatchObject({ resolution: "2K", quality: "low" });
  });

  it("preserves old invalid explicit values so refreshed contracts can explain them before submission", () => {
    const selected = model("image-2.5-flare-1K"), saved = { resolution: "4K", quality: "custom-quality", size: "4097x2051", aspect_ratio: "7:3" };
    expect(normalizedParametersForModel("image-generation", "langframe", selected, saved)).toMatchObject(saved);
    const video = model("veo-3.1-fast");
    expect(normalizedParametersForModel("video-generation", "langframe", video, { duration: 6, resolution: "720P", ratio: "9:16" }))
      .toMatchObject({ duration: 6, resolution: "720P", ratio: "9:16" });
    expect(video.parameters?.find(parameter => parameter.key === "duration")?.options?.map(option => option.value)).toEqual([8]);
  });

  it("quotes the exact ordinary/reference-video branch and refuses to estimate an unknown reference condition", () => {
    const selected = model("SD-2.5-（官渠）支持真人满血"), current = { resolution: "720P", duration: 10, ratio: "16:9" };
    expect(modelPriceSummary(selected, { ...current, has_reference_video: false })).toBe("0.79 CNY / 秒");
    expect(modelPriceSummary(selected, { ...current, has_reference_video: true })).toBe("0.99 CNY / 秒");
    expect(modelEstimatedQuote(selected, { ...current, has_reference_video: false })?.cost).toBe("7.9 CNY");
    expect(modelEstimatedQuote(selected, { ...current, has_reference_video: true })?.cost).toBe("9.9 CNY");
    expect(modelEstimatedQuote(selected, current)).toBeUndefined();
    const unselected = modelPriceSummary(selected, current);
    expect(unselected).not.toBe("0.79 CNY / 秒");
    expect(unselected).not.toBe("0.99 CNY / 秒");
    expect(modelPriceSummary(model("SD2.0-（官渠）支持真人903"), { duration: 10, resolution: "720P" })).toBe("2.9 CNY / 次");
  });

  it("links image quotes to chosen tiers without substituting dimensions or another group tariff", () => {
    const selected = model(imageId);
    expect(modelPriceSummary(selected, { resolution: "2K", size_tier: "2K", size: "3501x2301", quality: "max" })).toBe("0.18 CNY / 张");
    expect(modelPriceSummary(selected, { resolution: "4K", size_tier: "4K", size: "3501x2301", quality: "max" })).toBe("0.2 CNY / 张");
    expect(modelEstimatedQuote(selected, { resolution: "4K", size_tier: "4K", quality: "max", n: 2 })?.cost).toBe("0.4 CNY");
    expect(modelPriceSummary(model("image-2.5-flare-1K"), { resolution: "1K", quality: "max" })).toBe("0.03 CNY / 张");
    expect(currentSupplierUnitPrice(selected, { resolution: "4K", size_tier: "4K", size: "3840x2160", quality: "max" })).toBe("0.2 CNY / 张");
    expect(modelPickerPriceCompact(selected)).toMatch(/0\.15.*0\.2/u); // Candidate menus still show their complete tariff range.
  });

  it("keeps the internal scope as the selection value while showing the Key's saved label in canvas group choices", () => {
    const source: ProviderConnectionView = { id: "scope-connection", name: "狼帧 · Key f6 · 图片与视频", provider: "langframe", apiKey: "", apiKeySet: true,
      config: { supplierName: "狼帧", supplierKey: "custom-wolf", modelGroup: "langframe-key:fixture-uuid:canvas", langframeKeyScope: true, usage: "canvas" } };
    const group = providerConnectionGroup(source), label = providerConnectionGroupDisplayLabel(source);
    expect(group).toBe("langframe-key:fixture-uuid:canvas");
    expect(label).toBe("Key f6 · 图片与视频");
    const options = [{ id: source.id, name: source.name, supplier: "custom-wolf", supplierLabel: "狼帧", group, groupLabel: label }];
    expect(pickerConnectionGroups(options, "custom-wolf")[0]).toMatchObject({ group, label });
    expect(choosePickerConnection(options, source.id, "custom-wolf", group)?.id).toBe(source.id);
    expect(providerConnectionGroupDisplayLabel({ ...source, name: group })).toBe("Key · 图片与视频");
    expect(providerConnectionGroupDisplayLabel({ ...source, provider: "openai" })).toBe(group);
  });

  it("renders the actual canvas node tooltip and current 4K unit price without an internal Key scope UUID", async () => {
    const { WorkflowNode } = await import("../components/workflow-node");
    const selected = model(imageId), parameters = { resolution: "4K", size_tier: "4K", size: "3840x2160", quality: "max" };
    const html = renderToStaticMarkup(React.createElement(ReactFlowProvider, null, React.createElement(WorkflowNode, {
      id: "langframe-quote", type: "workflow", selected: false, draggable: true, dragging: false,
      selectable: true, deletable: true, zIndex: 0, isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
      data: { nodeType: "image-generation", label: "狼帧图片", provider: "langframe", connectionId: "scope-connection", model: selected.id,
        parameters, parts: [], inputs: [], outputs: [], linkedAssets: [], modelOptions: [selected], modelOptionsAuthoritative: true,
        connectionOptions: [{ id: "scope-connection", name: "狼帧 · Key f6 · 图片与视频", provider: "langframe", supplier: "custom-wolf", supplierLabel: "狼帧",
          group: "langframe-key:fixture-uuid:canvas", groupLabel: "Key f6 · 图片与视频", available: true }] },
    } satisfies React.ComponentProps<typeof WorkflowNode>)));
    expect(html).toContain('class="node-model-price">0.2 CNY / 张</small>');
    expect(html).toContain("狼帧 · Key f6 · 图片与视频");
    expect(html).not.toContain("langframe-key:");
    expect(html).not.toContain("0.15–0.2");
  });

  it("keeps menu names free of generated parameter summaries while offering separate compact prices", () => {
    for (const selected of bind()) {
      const original = catalog.models.find(model => model.id === selected.id)!;
      expect(selected.name).toBe(original.name);
      const label = cleanModelDisplayName(selected.name, selected.metadata?.priceLabel);
      expect(label).not.toMatch(/\d+\s*[×x]\s*\d+|\d+:\d+|档位\s*·|质量=/u);
      expect(label).not.toContain("最高质量");
    }
    expect(modelPickerPriceCompact(model(imageId))).toMatch(/0\.15.*0\.2.*CNY.*张/u);
    expect(modelPickerPriceCompact(model(imageId))).not.toMatch(/\d+\s*[×x]\s*\d+|16:9/u);
  });
});
