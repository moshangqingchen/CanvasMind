import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSupplierCatalog, type ModelDescriptor } from "@super-canvas/providers";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { applySupplierCatalogPrices } from "./supplier-model-pricing";
import { modelPriceSummary } from "./model-display";
import { guardNativeVideoRunnableContract } from "./native-video-runnable-contract";
import { normalizedParametersForModel } from "./model-parameters";
import { effectiveImageCapabilities } from "./supplier-capabilities";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/chuangxiang-video-contract-20261018.json", import.meta.url), "utf8"));
const rows: { name: string }[] = fixture.newModels;
const checkedAt = fixture.sources.plaza.sampledAt;
const connection = { provider: "openai", config: { baseUrl: "https://vapi.chuangxiangai.asia", usage: "canvas", accountKeyGroupId: "27",
  accountKeyGroup: "视频更名显示", modelGroup: "视频更名显示", scannedModelIds: rows.map(m => m.name), modelScanStatus: "live" } };

describe("Creative fresh videos through catalog, saved enrichment and parameter UI", () => {
  it("classifies, prices and binds every new exact ID using the stable official group", () => {
    const parsed = parseSupplierCatalog({ data: { groups: [{ id: 27, name: "视频更名显示", models: fixture.newModels }] } },
      { supplierSiteUrl: connection.config.baseUrl, checkedAt });
    expect(parsed.groups[0]?.models.every(m => m.capability === "video")).toBe(true);
    const input: ModelDescriptor[] = rows.map(m => ({ id: m.name, name: m.name, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"],
      metadata: { canvasRunnable: false, canvasUnavailableReason: "该型号的视频参数与调用协议待供应商文档确认", parameterControlsUnavailable: true } }));
    const enriched = applySupplierCatalogPrices(input, "视频更名显示", { ...parsed, status: "live", checkedAt });
    const bound = bindScannedModelProtocols(connection, enriched).models;
    expect(bound).toHaveLength(11);
    for (const model of bound) {
      expect(model.metadata?.canvasRunnable).toBe(true);
      expect(model.metadata?.parameterControlsUnavailable).toBeUndefined();
      expect(guardNativeVideoRunnableContract(connection, model).metadata?.canvasRunnable).toBe(true);
      expect(model.pricing?.kind).toBe("per-request");
      const native = fixture.models.find((m: { id: string }) => m.id === model.id), resolution = native.supported_resolutions[0];
      expect(modelPriceSummary(model, { resolution, duration: native.duration_seconds.min })).toBe(modelPriceSummary(model, { resolution, duration: native.duration_seconds.max }));
      expect(modelPriceSummary(model, { resolution, duration: native.duration_seconds.min })).toContain("CNY / 次");
    }
    expect(input.every(m => m.metadata?.canvasRunnable === false)).toBe(true);
    const fixed = bound.find(m => m.id === "sd17-seedance-2.5-3")!;
    const old = { duration: 29, resolution: "1080p" };
    expect(normalizedParametersForModel("video-generation", "openai", fixed, old)).toMatchObject(old);
    expect(old).toEqual({ duration: 29, resolution: "1080p" });
  });

  it.each(["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k"])("keeps official xhigh/max controls in effective GPT2 UI for %s", id => {
    const imageConnection = { id: "cx-image", provider: "openai", config: { baseUrl: connection.config.baseUrl, accountKeyGroup: "生图", accountKeyGroupId: "43", usage: "canvas" } };
    const model: ModelDescriptor = { id, name: id, operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true } };
    const supplier = { id: "cx", name: "创想ai", supplierKey: "chuangxiang", apiUrl: connection.config.baseUrl, siteUrl: connection.config.baseUrl,
      kind: "sub2api" as const, createdAt: "now", updatedAt: "now", scanStatus: "live" as const, catalog: { groups: [] } };
    const effective = effectiveImageCapabilities({ supplier, connection: imageConnection, model, fingerprint: "offline" });
    expect(effective.model.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value))
      .toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
  });
});
