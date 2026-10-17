import type { ModelDescriptor } from "@super-canvas/providers";
import type { MemoryRepositorySnapshot, ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { MemoryRepository } from "@super-canvas/db";

export const CATALOG_SCALE_SUPPLIERS = 16;
export const CATALOG_SCALE_CONNECTIONS = 131;
export const CATALOG_SCALE_MODELS_PER_KEY = 64;
export const CATALOG_SCALE_PUBLIC_MODELS = 512;
export const CATALOG_SCALE_SCENARIOS = ["partial-price", "auxiliary-failure", "aggregate-incomplete", "member-source-failure", "hard-truncation", "soft-drop", "authentication", "balance", "upstream", "rate-limited", "sibling-concurrency", "manual-field-race", "shared-document", "never-published", "price-change", "explicit-unpublished"] as const;
export type CatalogScaleScenario = typeof CATALOG_SCALE_SCENARIOS[number];
const initialAt = "2001-01-01T00:00:00.000Z";
export function catalogScaleModels(supplierIndex: number, count = CATALOG_SCALE_MODELS_PER_KEY, checkedAt = initialAt): ModelDescriptor[] {
  return Array.from({ length: count }, (_, index) => ({ id: "fixture-" + supplierIndex + "-full-model-" + index,
    name: "Fixture model " + index, operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
    parameters: [{ key: "quality", label: "Quality", control: "select", default: "high", options: [{ value: "high", label: "High" }, { value: "low", label: "Low" }] }],
    pricing: { kind: "per-image", currency: "CNY", billingUnit: "image", unitAmount: .1 + supplierIndex / 100, checkedAt, confidence: "exact" },
    metadata: { fixtureOnly: true } }));
}
export function catalogScaleDocument(supplierIndex: number) {
  return { openapi: "3.1.0", security: [{ bearer: [] }], components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } }, paths: {
    "/images/generations": { post: { requestBody: { content: { "application/json": { schema: { type: "object", required: ["model", "prompt"],
      properties: { model: { type: "string", enum: catalogScaleModels(supplierIndex, CATALOG_SCALE_PUBLIC_MODELS).map(model => model.id) }, prompt: { type: "string" },
        quality: { type: "string", enum: ["high", "low"], default: "high" } } } } } }, responses: { "200": { content: { "application/json": {
          schema: { type: "object", properties: { data: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } } } },
        } } } } } },
  } };
}
/** Entirely invented fixture; no profile, supplier account, key or imported production row. */
export function catalogScaleSnapshot(options: { futureDue?: boolean; paused?: boolean } = {}): MemoryRepositorySnapshot {
  const suppliers: SupplierRecord[] = [], connections: ProviderConnectionRecord[] = [];
  for (let index = 0; index < CATALOG_SCALE_SUPPLIERS; index++) {
    const id = "scale-supplier-" + index, baseUrl = "https://scale-" + index + ".invalid/v1";
    suppliers.push({ id, supplierKey: "fixture-" + index, name: "Scale fixture supplier " + index, kind: "newapi", siteUrl: new URL(baseUrl).origin,
      apiUrl: baseUrl, createdAt: initialAt, updatedAt: initialAt, scanStatus: "live", scanComplete: true, catalog: { groups: [] },
      state: { version: 1, revision: 1, visibility: "visible", sourceId: "scale-source-" + index, fingerprint: "fixture-" + index, history: [] } });
    for (let key = 0; key < (index < 3 ? 9 : 8); key++) connections.push({ id: id + "-key-" + key, name: "Fixture Key " + key,
      provider: "openai", encryptedSecret: "opaque-fictional-" + index + "-" + key, createdAt: initialAt, updatedAt: initialAt,
      config: { supplierId: id, supplierSourceId: "scale-source-" + index, baseUrl, accountKeyGroupId: "group-" + key,
        scaleSupplierIndex: index, scaleKeyIndex: key, scaleScenario: CATALOG_SCALE_SCENARIOS[index],
        modelCatalogModels: catalogScaleModels(index).map(model => { if (index === 13) delete model.pricing;
          if (index === 14) model.metadata = { ...model.metadata, measuredPrice: { requestId: "fictional-request-14", amount: .21, currency: "CNY", parameters: { quality: "high" }, checkedAt: initialAt } }; return model; }), scannedModelIds: catalogScaleModels(index).map(model => model.id), modelScanStatus: "live",
        defaultModel: "fixture-" + index + "-full-model-1", parameters: { quality: "high", userMustKeep: true },
        ...(options.futureDue || options.paused ? { catalogCheckAttemptedAt: initialAt, catalogCheckAttemptRevision: "scale-revision",
          catalogCheckPaused: options.paused === true, catalogCheckFailureStreak: options.paused ? 3 : 0 } : {}),
      } });
  }
  return { ...new MemoryRepository().exportSnapshot(), suppliers, connections };
}
