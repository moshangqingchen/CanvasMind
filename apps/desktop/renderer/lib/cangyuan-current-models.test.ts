import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cangyuanCatalogFromPricing, cangyuanConnectorForModels } from "./cangyuan-catalog";
import { cangyuanImageConnectionConfig } from "./provider-presets";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { modelPriceSummary } from "./model-display";
import { parametersWithDefaults } from "./model-parameters";
import { effectiveImageCapabilities } from "./supplier-capabilities";
import { GenericRestAdapter, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/cangyuan-current-pricing.json", import.meta.url), "utf8"));
const catalog = () => cangyuanCatalogFromPricing(fixture);
const connection = () => ({ provider: "rest", config: cangyuanImageConnectionConfig("IMAGE") });

describe("current Cangyuan image catalog and saved scan integration", () => {
  it("shows the actual conditional price instead of only the web starting price", () => {
    const models = catalog().groups.IMAGE;
    const image = models.find(m => m.id === "gpt-image-2-x")!;
    const image25 = models.find(m => m.id === "gpt-image-2.5-x")!;
    expect(modelPriceSummary(image, {})).toBe("0.095 CNY / 张");
    expect(modelPriceSummary(image25, {})).toBe("0.44 CNY / 张");
    expect(modelPriceSummary(image25, { tier: "web", series: "flare", quality: "max" })).toBe("0.025 CNY / 张");
    expect(modelPriceSummary(image25, { tier: "2k", series: "flare", quality: "high" })).toBe("0.18 CNY / 张");
    expect(modelPriceSummary(image25, { tier: "2k", series: "flare", quality: "max" })).toBe("0.36 CNY / 张");
    expect(catalog().marketplaceGroups.find(g => g.id === "IMAGE")?.models.find(m => m.id === image25.id)?.priceLabel).toContain("¥0.44/张");
  });

  it("prices Midjourney per request while retaining every returned image", () => {
    const model = catalog().groups.IMAGE.find(m => m.id === "midjourney-v7")!;
    expect(model.pricing).toMatchObject({ kind: "per-request", currency: "CNY", unitAmount: 0.19 });
    expect(modelPriceSummary(model, {})).toBe("0.19 CNY / 次");
    expect(model.metadata?.multipleOutputsPerRequest).toBe(true);
  });

  it("refreshes exact descriptors without changing shared transport overrides or adding IDs", () => {
    const scanned: ModelDescriptor[] = catalog().groups.IMAGE.map(m => ({ ...m, parameters: undefined,
      metadata: { ...m.metadata, canvasRunnable: false, canvasUnavailableReason: "画布协议尚未内置" } }));
    const current = connection();
    const bound = bindScannedModelProtocols(current, scanned);
    expect(bound.models.map(m => m.id).sort()).toEqual(scanned.map(m => m.id).sort());
    for (const model of bound.models) expect(model.metadata?.canvasRunnable).toBe(true);
    expect(bound.connector?.modelOverrides).toEqual(current.config.connector.modelOverrides ?? {});
    const rebound = bindScannedModelProtocols({ ...current, config: { ...current.config, connector: bound.connector } }, bound.models);
    expect(rebound.models).toEqual(bound.models);
  });

  it("preserves an explicit permission denial and never applies these contracts to another supplier", () => {
    const blocked: ModelDescriptor = { id: "gpt-image-2.5-x", name: "blocked", operations: ["image.generate"], metadata: { canvasRunnable: false, canvasUnavailableReason: "403 权限拒绝" } };
    expect(bindScannedModelProtocols(connection(), [blocked]).models[0]?.metadata?.canvasRunnable).toBe(false);
    const other = { provider: "rest", config: { ...connection().config, baseUrl: "https://other.example" } };
    expect(bindScannedModelProtocols(other, [blocked]).models[0]?.metadata?.cangyuanCurrentContract).toBeUndefined();
  });

  it("uses legal defaults and keeps tier/series when building actual controls", () => {
    const model = catalog().groups.IMAGE.find(m => m.id === "gpt-image-2.5-x")!;
    expect(parametersWithDefaults(model.parameters!, {})).toMatchObject({ series: "sunburst", tier: "4k", quality: "max", n: 1 });
    const capabilities = effectiveImageCapabilities({
      supplier: {
        id: "cangyuan", name: "沧元算力", supplierKey: "cangyuan", kind: "newapi", scanStatus: "live",
        apiUrl: "https://ai.cangyuansuanli.cn", siteUrl: "https://ai.cangyuansuanli.cn",
        catalog: { groups: [{ id: "IMAGE", label: "IMAGE", models: [] }] }, createdAt: "now", updatedAt: "now",
      },
      connection: { id: "cangyuan-image-offline", ...connection() }, model, fingerprint: "offline-current-catalog",
    });
    expect(capabilities).toBeTruthy();
    expect(model.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    const connector = cangyuanConnectorForModels("IMAGE", [model]);
    expect(connector.assetsRequirePublicUrls).toBe(connection().config.connector.assetsRequirePublicUrls);
    expect(connector.modelOverrides?.[model.id]).toBeUndefined();
  });

  it("requires HTTPS references only for the current native request without changing its shared connector", async () => {
    const model = catalog().groups.IMAGE.find(m => m.id === "gpt-image-2.5-x")!;
    const current = connection();
    const connector = cangyuanConnectorForModels("IMAGE", [model]);
    const before = structuredClone(connector);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://images.example/result.png" }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "offline", provider: "rest", baseUrl: current.config.baseUrl,
      apiKey: "offline-test", settings: { ...current.config, connector } }]), { fetch: fetcher });
    const request = { connectionId: "offline", model: model.id, operation: "image.edit" as const, prompt: "offline reference test",
      idempotencyKey: "offline", parameters: { tier: "4k", series: "sunburst", quality: "max", n: 1 } };
    await expect(adapter.submit({ ...request, assets: [{ id: "local", kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] })).rejects.toThrow(/HTTPS/u);
    expect(fetcher).not.toHaveBeenCalled();
    await adapter.submit({ ...request, assets: [{ id: "remote", kind: "image", mimeType: "image/png", url: "https://images.example/reference.png" }] });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).images).toEqual(["https://images.example/reference.png"]);
    expect(connector).toEqual(before);
  });

  it.each(["flare", "sunburst"])("refreshes the standalone %s 4K contract to sixteen references without x-model fields", async series => {
    const model = catalog().groups.IMAGE.find(m => m.id === `gpt-image-2.5-${series}-4k`)!;
    expect(model.limits?.maxInputImages).toBe(16);
    expect(model.parameters?.some(p => ["tier", "series", "mask"].includes(p.key))).toBe(false);
    const standard = series === "flare" ? "0.2" : "0.22";
    const maximum = series === "flare" ? "0.4" : "0.44";
    expect(modelPriceSummary(model, { quality: "high" })).toBe(`${standard} CNY / 张`);
    expect(modelPriceSummary(model, { quality: "max" })).toBe(`${maximum} CNY / 张`);
    const current = connection();
    const connector = cangyuanConnectorForModels("IMAGE", [model]);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://images.example/result.png" }] }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "offline", provider: "rest", baseUrl: current.config.baseUrl,
      apiKey: "offline-test", settings: { ...current.config, connector } }]), { fetch: fetcher });
    const references = Array.from({ length: 16 }, (_, i) => ({ id: String(i), kind: "image" as const, mimeType: "image/png", url: `https://images.example/${i}.png` }));
    await adapter.submit({ connectionId: "offline", model: model.id, operation: "image.edit", prompt: "offline fixed 4k references",
      idempotencyKey: "offline", assets: references, parameters: { quality: "max", n: 1, aspect_ratio: "16:9", tier: "web", series: "flare", mask: "https://images.example/mask.png" } });
    expect(String(fetcher.mock.calls[0]![0])).toBe(`${current.config.baseUrl}/v1/images/edits`);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(body.images).toEqual(references.map(a => a.url));
    expect(body.model).toBe(model.id); expect(body.quality).toBe("max");
    expect(body).not.toHaveProperty("tier"); expect(body).not.toHaveProperty("series"); expect(body).not.toHaveProperty("mask");
  });
});
