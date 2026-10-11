import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));

import { createSupplierRecord } from "../../../lib/supplier-service";
import { readProviderModelInventory } from "../../../lib/provider-model-inventory";
import { bindScannedModelProtocols } from "../../../lib/scanned-model-protocols";
import * as supplierPricing from "../../../lib/supplier-model-pricing";
import { modelPickerPriceData } from "../../../lib/model-picker-data";
import { modelPriceSummary } from "../../../lib/model-display";

const quoteAt = "2026-10-10T08:00:00.000Z", failedAt = "2026-10-11T04:53:56.000Z";
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.upstream.mockReset().mockRejectedValue(new Error("Local retained-price persistence must not contact upstream"));
  vi.stubGlobal("fetch", mocks.upstream);
});
afterEach(() => { expect(mocks.upstream).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture(kind: "gen-default" | "gen-base64" | "gen-gemini-url" | "gen-fal" | "chuang" | "chuang-chat") {
  const chuang = kind.startsWith("chuang"), chat = kind === "chuang-chat", origin = chuang ? "https://vapi.chuangxiangai.asia" : "https://genimage.pro";
  const group = chat ? "gpt-不降智 0.2x" : chuang ? "生图" : kind === "gen-base64" ? "gptResponseBase64" : kind === "gen-gemini-url" ? "geminiResponseUrl" : kind === "gen-fal" ? "香蕉逆向-fal" : "default";
  const ids = chat ? ["codex-auto-review", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"] : chuang ? ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k", ...["flare", "sunburst"].flatMap(family =>
    ["1k", "2k", "4k"].map(tier => `gpt-image-2.5-${family}-${tier}`))] : kind === "gen-gemini-url" ? ["gemini-nano-banana-2.1", "gemini-3.1-flash-image-preview", "gemini-3.1-flash-lite-image", "gemini-3-pro-image-preview", "gemini-2.5-flash-image"] : kind === "gen-fal" ? ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"] : kind === "gen-default" ? ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image", "gpt-image-2", "gpt-image-2.5-sunburst", "gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3-pro-image-preview", "gpt-image-2.5-flare"] : ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
  // The actual saved group38 has six complete GPT tariffs. The three current
  // Key-only IDs have no published price; keep that exact distinction.
  const quotedIds = chat ? ids.filter(id => !["codex-auto-review", "gpt-6", "gpt-6-luna"].includes(id)) : ids;
  const officialGroupId = chat ? "38" : "43";
  const supplier = await createSupplierRecord({ name: `Local price repair ${kind}`, kind: chuang ? "sub2api" : "newapi", siteUrl: origin, apiUrl: origin + "/v1" });
  const official = await mocks.repository.saveSupplier({ ...supplier, scanStatus: chuang ? "failed" : "live", scanComplete: !chuang,
    scannedAt: quoteAt, catalog: { groups: [{ id: group, label: group, ...(chuang ? { supplierGroupId: officialGroupId } : {}),
      details: chuang ? { source: "key-groups", stale: true, ...(chat ? { rateMultiplier: 2 } : {
        description: "GPT Image、Nano Banana、Gemini：1K / 2K / 4K；Midjourney：1K / 2K。按模型及档位计费，价格见模型广场。", rateMultiplier: 1, imageRateMultiplier: 1 }) }
        : { source: "key-groups", ...(kind === "gen-default" ? { description: "默认分组" } : {}), rateMultiplier: ["gen-default", "gen-base64"].includes(kind) ? 2 : 1 },
      models: quotedIds.map(id => ({
      id, capability: chat ? "chat" : "image", priceLabel: chat ? "输入 ¥1/1M · 输出 ¥6/1M" : chuang ? "¥0.2/张" : "$0.16/次", metadata: { [chuang ? "chuangxiangCatalogPricing" : "officialCatalogPricing"]: {
        kind: chat ? "token" : chuang ? "per-image" : "per-request", currency: chuang ? "CNY" : "USD", ...(chat ? { inputPerMillion: 1, outputPerMillion: 6 } : { unitAmount: chuang ? .2 : .16 }), checkedAt: quoteAt,
        sourceUrl: origin + (chuang ? "/model-plaza" : ""), confidence: chuang ? "snapshot" : "exact" },
        ...(chuang ? { supplierCatalogModelStale: true, supplierCatalogPriceCheckedAt: quoteAt } : {}) },
    })) }] } });
  let connection = await mocks.repository.saveConnection({ id: `local-price-${kind}`, name: kind, provider: "openai", config: {
    supplierId: official.id, supplierSourceId: official.state!.sourceId, baseUrl: official.apiUrl, modelGroup: group, accountKeyGroup: group,
    ...(chuang ? { accountKeyGroupId: officialGroupId } : {}), customGroup: true, modelScanStatus: "live", modelScanComplete: true,
    modelScanCheckedAt: failedAt, modelScanLastSuccessAt: failedAt, modelScanRequestId: "original-upstream-read", scannedModelIds: ids,
    modelCatalogModels: ids.map(id => ({ id, name: id, operations: chat ? [] : ["image.generate"], outputKinds: [chat ? "text" : "image"], metadata: { liveInventory: true,
      priceSource: "supplier-catalog", supplierPriceGroup: group, ...(chuang ? { supplierPriceGroupId: officialGroupId } : {}),
      priceStatus: "failed", priceLabel: "价格查询失败", priceCheckedAt: failedAt, priceLastAttemptAt: failedAt } })) as never,
    savedUserValues: { size: "2496x3312", quality: "max", ratio: "3:4" },
  } });
  if (chat) {
    const rows = await supplierPricing.enrichSupplierModelPrices(connection, connection.config.modelCatalogModels as unknown as ModelDescriptor[], false, false);
    connection = await mocks.repository.saveConnection({ ...connection, config: { ...connection.config, modelCatalogModels: rows.map(row => ({ ...row,
      pricing: undefined, metadata: { ...row.metadata, priceLabel: "价格查询失败", priceStatus: "failed", priceCheckedAt: failedAt, priceLastAttemptAt: failedAt,
        priceLastAttemptStatus: undefined } })) as never } });
  }
  for (let i = 0; i < 3; i++) {
    const bound = bindScannedModelProtocols(connection, connection.config.modelCatalogModels as unknown as ModelDescriptor[]);
    connection = await mocks.repository.saveConnection({ ...connection, config: { ...connection.config, modelCatalogModels: bound.models as never,
      ...(bound.connector ? { connector: bound.connector as never, modelProtocolTemplate: bound.templateConnector as never } : {}) } });
  }
  return { connection, official, ids, quotedIds };
}

describe("normal local GET persists existing same-source official prices without another scan", () => {
  it.each(["gen-default", "gen-base64", "gen-gemini-url", "gen-fal", "chuang", "chuang-chat"] as const)("repairs %s, preserves model/parameter/scan identities and becomes idempotent", async kind => {
    const { connection, official, ids, quotedIds } = await fixture(kind);
    const priceRead = vi.spyOn(supplierPricing, "enrichSupplierModelPrices");
    const save = vi.spyOn(mocks.repository, "saveConnection");
    const read = (query = "") => readProviderModelInventory(new Request(`http://localhost/api/providers/${connection.id}/models${query}`),
      { params: Promise.resolve({ id: connection.id }) });
    const response = await read();
    expect(response.status).toBe(200);
    const apiModels: ModelDescriptor[] = await response.json();
    const saved = (await mocks.repository.getConnection(connection.id))!;
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual({ expected: connection });
    expect(priceRead.mock.calls.every(args => args[2] === false && args[3] === false)).toBe(true);
    expect(await mocks.repository.getSupplier(official.id)).toEqual(official);
    expect(saved.config.scannedModelIds).toEqual(ids);
    for (const field of ["supplierId", "supplierSourceId", "baseUrl", "modelGroup", "accountKeyGroup", "accountKeyGroupId", "modelScanStatus", "modelScanComplete",
      "modelScanCheckedAt", "modelScanLastSuccessAt", "modelScanRequestId", "savedUserValues"])
      expect(saved.config[field]).toEqual(connection.config[field]);
    const previous = connection.config.modelCatalogModels as unknown as ModelDescriptor[], persisted = saved.config.modelCatalogModels as unknown as ModelDescriptor[];
    const sourceDetailKeys = ["supplierGroupDescription", "supplierGroupResolutionLabel", "imageResolutionOrigins", "supplierGroupInfoSource", "supplierGroupInfoStale", "supplierGroupCheckedAt"];
    const withoutPrice = (row: ModelDescriptor) => {
      const rest = structuredClone(row); delete rest.pricing;
      const metadata = { ...rest.metadata };
      for (const key of ["priceLabel", "priceSource", "priceStatus", "priceCheckedAt", "priceLastAttemptAt", "priceLastAttemptStatus", "supplierPriceGroup", "supplierPriceGroupId"])
        delete metadata[key];
      // Exactly these six sourced group description fields are a legitimate
      // migration of older raw snapshots. Assert the precise values below,
      // before excluding them from the comparison of unrelated descriptors.
      if (kind.startsWith("gen-")) for (const key of sourceDetailKeys) delete metadata[key];
      return { ...rest, metadata };
    };
    for (let i = 0; i < persisted.length; i++) {
      expect(persisted[i]?.id).toBe(previous[i]?.id);
      expect(persisted[i]?.parameters).toEqual(previous[i]?.parameters);
      expect(persisted[i]?.operations).toEqual(previous[i]?.operations);
      if (kind.startsWith("gen-")) {
        expect(Object.fromEntries(sourceDetailKeys.filter(key => previous[i]?.metadata?.[key] !== undefined).map(key => [key, previous[i]!.metadata![key]]))).toEqual({});
        expect(Object.fromEntries(sourceDetailKeys.map(key => [key, persisted[i]?.metadata?.[key]]))).toEqual({
          supplierGroupDescription: kind === "gen-default" ? "默认分组" : "", supplierGroupResolutionLabel: "", imageResolutionOrigins: {},
          supplierGroupInfoSource: "key-groups", supplierGroupInfoStale: false, supplierGroupCheckedAt: quoteAt,
        });
      }
      expect(withoutPrice(persisted[i]!)).toEqual(withoutPrice(previous[i]!));
      if (!quotedIds.includes(persisted[i]!.id)) {
        expect(persisted[i]?.pricing).toBeUndefined();
        expect(modelPickerPriceData(persisted[i])).toBe("—");
        continue;
      }
      expect(persisted[i]?.pricing).toMatchObject({ checkedAt: quoteAt, sourceUrl: kind.startsWith("chuang") ? "https://vapi.chuangxiangai.asia/model-plaza" : "https://genimage.pro" });
      expect(persisted[i]?.metadata).toMatchObject({ priceStatus: "partial", priceCheckedAt: quoteAt, priceLastAttemptAt: failedAt, priceLastAttemptStatus: "failed" });
      expect(modelPickerPriceData(persisted[i])).toContain("上次记录");
      expect(modelPriceSummary(persisted[i], { quality: "max" })).toContain(kind === "chuang-chat" ? "输入" : kind === "chuang" ? "0.2" : "0.16");
    }
    expect(apiModels.map(row => row.pricing)).toEqual(persisted.map(row => row.pricing));
    save.mockClear();
    expect((await read()).status).toBe(200);
    expect(save).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(connection.id)).toEqual(saved);
  });
  it("keeps cached=1 readback strictly non-writing while exposing the same historical tariff", async () => {
    const { connection } = await fixture("gen-default");
    const save = vi.spyOn(mocks.repository, "saveConnection");
    const response = await readProviderModelInventory(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`),
      { params: Promise.resolve({ id: connection.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).every((row: ModelDescriptor) => row.pricing?.unitAmount === .16)).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(connection.id)).toEqual(connection);
  });
});
