import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets } from "@super-canvas/providers/image-size-presets";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));

import { readProviderModelInventory } from "./provider-model-inventory";
import * as supplierPricing from "./supplier-model-pricing";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/mikoto-rest-whole-connection.json", import.meta.url), "utf8")) as {
  connection: ProviderConnectionRecord; supplier: SupplierRecord;
};
const models = (record: ProviderConnectionRecord) => record.config.modelCatalogModels as unknown as ModelDescriptor[];
const target = (rows: ModelDescriptor[]) => rows.find(model => model.id === "gpt-image-2")!;
const differences = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys({ ...before, ...after })
  .filter(key => JSON.stringify(canonical(before[key])) !== JSON.stringify(canonical(after[key])));
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const priceTimes = ["priceCheckedAt", "priceLastAttemptAt"];
const userPresetKeys = ["imageUserSizePresets", "imageUserSizePresetSource", "imageUserSizePresetTiers", "imageUserSizePresetParameter", "imageUserSizeSourceOptions", "imageUserSizeSourceDescription"];
function modelDelta(before: ModelDescriptor, after: ModelDescriptor) {
  const fields = differences(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  return { id: before.id, fields, topLevel: Object.fromEntries(fields.filter(key => key !== "metadata").map(key => [key,
    { before: before[key as keyof ModelDescriptor], after: after[key as keyof ModelDescriptor] }])),
  metadata: Object.fromEntries(differences(before.metadata ?? {}, after.metadata ?? {}).map(key => [key,
    { before: before.metadata?.[key], after: after.metadata?.[key] }])) };
}
function configDelta(before: ProviderConnectionRecord, after: ProviderConnectionRecord) {
  const config = differences(before.config, after.config);
  const containers = ["modelCatalogModels", "connector", "modelProtocolTemplate"] as const;
  return { configFields: config, containers: Object.fromEntries(containers.map(key => {
    const left = key === "modelCatalogModels" ? models(before) : (before.config[key] as { models: ModelDescriptor[] }).models;
    const right = key === "modelCatalogModels" ? models(after) : (after.config[key] as { models: ModelDescriptor[] }).models;
    return [key, { beforeIds: left.map(row => row.id), afterIds: right.map(row => row.id), beforeSha256: sha(before.config[key]), afterSha256: sha(after.config[key]),
      modelChanges: left.map(row => modelDelta(row, right.find(next => next.id === row.id)!)).filter(delta => delta.fields.length),
      nonModelContractChanged: key === "modelCatalogModels" ? false : JSON.stringify({ ...before.config[key] as object, models: undefined }) !== JSON.stringify({ ...after.config[key] as object, models: undefined }) }];
  })) };
}

beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.upstream.mockReset().mockRejectedValue(new Error("The exact saved inventory branch must not contact upstream"));
  vi.stubGlobal("fetch", mocks.upstream);
});
afterEach(() => { expect(mocks.upstream).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup() {
  const supplier = await mocks.repository.saveSupplier(structuredClone(fixture.supplier));
  const connection = await mocks.repository.saveConnection(structuredClone(fixture.connection));
  const read = (query = "") => readProviderModelInventory(new Request(`http://localhost/api/providers/${connection.id}/models${query}`),
    { params: Promise.resolve({ id: connection.id }) });
  return { supplier, connection, read };
}

describe("actual Mikoto 030 raw 21 model inventory to saved REST transport projection", () => {
  it("migrates the automatic GPT2 quote and user presets through inventory, pricing, binder and save", async () => {
    const { supplier, connection, read } = await setup();
    expect(models(connection)).toHaveLength(21);
    const save = vi.spyOn(mocks.repository, "saveConnection");
    const priceRead = vi.spyOn(supplierPricing, "enrichSupplierModelPrices");
    const response = await read();
    expect(response.status).toBe(200);
    const api: ModelDescriptor[] = await response.json();
    const saved = (await mocks.repository.getConnection(connection.id))!;
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual({ expected: connection });
    expect(priceRead.mock.calls.every(args => args[2] === false && args[3] === false)).toBe(true);
    expect(await mocks.repository.getSupplier(supplier.id)).toEqual(supplier);
    const apiImage = target(api), savedImage = target(models(saved));
    expect(differences(savedImage.metadata ?? {}, apiImage.metadata ?? {}).sort()).toEqual(["imageCapabilityEvidence", "imageCapabilityPolicy"]);
    expect(apiImage.metadata?.imageCapabilityPolicy).toBe(2);
    const displayEvidence = apiImage.metadata?.imageCapabilityEvidence as { modelId: string; sourceId: string; connectionId: string; resolution: string; kind: string; status: string }[];
    expect(displayEvidence.map(item => item.resolution)).toEqual(["2K", "4K"]);
    expect(displayEvidence.every(item => item.modelId === "gpt-image-2" && item.sourceId === fixture.supplier.state?.sourceId &&
      item.connectionId === connection.id && item.kind === "documentation" && item.status === "declared")).toBe(true);
    const apiWithoutDisplayEvidence = api.map(row => ({ ...row, metadata: Object.fromEntries(Object.entries(row.metadata ?? {})
      .filter(([key]) => !["imageCapabilityPolicy", "imageCapabilityEvidence"].includes(key))) }));
    expect(apiWithoutDisplayEvidence).toEqual(json(models(saved)));
    const old = target(models(connection)), current = target(models(saved));
    const oldMetadata = old.metadata ?? {}, currentMetadata = current.metadata ?? {};
    expect(differences(old as unknown as Record<string, unknown>, current as unknown as Record<string, unknown>).sort()).toEqual(["metadata", "name", "parameters", "pricing"]);
    expect(differences(oldMetadata, currentMetadata).sort()).toEqual(["imageQualityCompleteEnumSource", "imageQualityOptionsCompleteEnum", "imageResolutionTierSource", "imageResolutionTiers", "priceCheckedAt", "priceLabel", "priceLastAttemptAt", "priceSource", "priceStatus", "supplierGroupCheckedAt", "supplierPriceGroup", "supplierPriceGroupId", ...userPresetKeys].sort());
    expect(oldMetadata.imageResolutionTierSource).toBeUndefined();
    expect(oldMetadata.imageResolutionTiers).toBeUndefined();
    expect(currentMetadata.imageResolutionTierSource).toBe("official-key-group");
    expect(currentMetadata.imageResolutionTiers).toEqual(["2K", "4K"]);
    expect(oldMetadata.supplierGroupCheckedAt).toBe("2026-10-11T04:48:27.246Z");
    expect(currentMetadata.supplierGroupCheckedAt).toBe("2026-10-11T04:48:13.488Z");
    expect(current.name).toBe("GPT Image 2（原生4K）");
    expect(current.pricing).toEqual({ kind: "per-image", currency: "USD", billingUnit: "image", unitAmount: .08,
      sourceUrl: "https://api.mikoto.vip/api/v1/channels/available", checkedAt: "2026-10-11T04:48:13.488Z", confidence: "exact" });
    for (const row of models(connection)) {
      const next = models(saved).find(model => model.id === row.id)!;
      expect(next.parameters).toEqual(applyUserImageSizePresets({ ...row, metadata: {
        ...row.metadata, ...(row.id === "gpt-image-2" ? { imageResolutionTierSource: "official-key-group", imageResolutionTiers: ["2K", "4K"], imageQualityOptionsCompleteEnum: true } : {}),
      } }).parameters);
      expect(next.operations).toEqual(row.operations);
      if (row.id !== "gpt-image-2") {
        expect(differences(row.metadata ?? {}, next.metadata ?? {})).toEqual(priceTimes);
        for (const key of priceTimes) {
          expect(row.metadata?.[key]).toBe("2026-10-11T04:48:27.246Z");
          expect(next.metadata?.[key]).toBe("2026-10-11T04:48:13.488Z");
        }
        expect(json({ ...next, metadata: { ...next.metadata, priceCheckedAt: undefined, priceLastAttemptAt: undefined } }))
          .toEqual(json({ ...row, metadata: { ...row.metadata, priceCheckedAt: undefined, priceLastAttemptAt: undefined } }));
      }
    }
    expect(differences(connection.config, saved.config).sort()).toEqual(["connector", "modelCatalogModels", "modelProtocolTemplate"]);
    // Existing model protocol templates keep their distinct full IDs and routes.
    // Their model descriptors are checked separately from the current-Key rows.
    expect((saved.config.connector as { models: ModelDescriptor[] }).models).toEqual([current]);
    expect((saved.config.modelProtocolTemplate as { models: ModelDescriptor[] }).models.map(model => model.id))
      .toEqual((connection.config.modelProtocolTemplate as { models: ModelDescriptor[] }).models.map(model => model.id));
    const oldConnector = connection.config.connector as { models: ModelDescriptor[] };
    const firstTemplate = saved.config.modelProtocolTemplate as { models: ModelDescriptor[] };
    expect(target(firstTemplate.models)).toEqual(target(oldConnector.models));
    for (const row of (connection.config.modelProtocolTemplate as { models: ModelDescriptor[] }).models.filter(model => model.id !== "gpt-image-2"))
      expect(firstTemplate.models.find(model => model.id === row.id)).toEqual(row);
  });
  it("projects the managed template on the second local GET and is idempotent thereafter", async () => {
    const { connection, read } = await setup();
    const save = vi.spyOn(mocks.repository, "saveConnection");
    expect((await read()).status).toBe(200);
    const first = (await mocks.repository.getConnection(connection.id))!;
    save.mockClear();
    expect((await read()).status).toBe(200);
    const second = (await mocks.repository.getConnection(connection.id))!;
    expect(save).toHaveBeenCalledTimes(1);
    expect(differences(first.config, second.config)).toEqual(["modelProtocolTemplate"]);
    expect(models(second)).toEqual(models(first));
    expect(second.config.connector).toEqual(first.config.connector);
    const template = second.config.modelProtocolTemplate as { models: ModelDescriptor[] };
    expect(target(template.models)).toEqual(target(models(second)));
    save.mockClear();
    expect((await read()).status).toBe(200);
    const third = (await mocks.repository.getConnection(connection.id))!;
    expect(save).not.toHaveBeenCalled();
    expect(third).toEqual(second);
    // This is an optional offline evidence emission; ordinary regressions never
    // write files. It records safe exact contract differences, not profile data.
    if (process.env.MIKOTO_WHOLE_CONNECTION_PROOF_PATH) {
      const out = resolve(process.env.MIKOTO_WHOLE_CONNECTION_PROOF_PATH);
      const allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-b") + sep;
      if (!out.startsWith(allowed) || !out.endsWith(".json")) throw new Error("Evidence output must stay in audit-b");
      writeFileSync(out, JSON.stringify({ fixture: "lib/fixtures/mikoto-rest-whole-connection.json", connectionId: connection.id,
        modelCount: models(connection).length, ordinarySavedBranchNetworkRequests: mocks.upstream.mock.calls.length,
        firstGet: configDelta(connection, first), secondGet: configDelta(first, second), thirdGet: configDelta(second, third),
        ordinaryGetSaveCounts: [1, 1, 0], nodeParametersWritten: false, actualProfileWrites: 0 }, null, 2) + "\n");
    }
  });
  it("keeps cached=1 non-writing while exposing the current quote for all 21 actual rows", async () => {
    const { connection, read } = await setup();
    const save = vi.spyOn(mocks.repository, "saveConnection");
    const response = await read("?cached=1");
    expect(response.status).toBe(200);
    const api: ModelDescriptor[] = await response.json();
    expect(api).toHaveLength(21);
    expect(target(api).pricing?.sourceUrl).toBe("https://api.mikoto.vip/api/v1/channels/available");
    expect(target(api).parameters).toEqual(applyUserImageSizePresets({ ...target(models(connection)), metadata: {
      ...target(models(connection)).metadata, imageResolutionTierSource: "official-key-group", imageResolutionTiers: ["2K", "4K"], imageQualityOptionsCompleteEnum: true,
    } }).parameters);
    for (const row of models(connection).filter(model => model.id !== "gpt-image-2")) {
      const next = api.find(model => model.id === row.id)!;
      expect(differences(row.metadata ?? {}, next.metadata ?? {})).toEqual(priceTimes);
      expect(json({ ...next, metadata: { ...next.metadata, priceCheckedAt: undefined, priceLastAttemptAt: undefined } }))
        .toEqual(json({ ...row, metadata: { ...row.metadata, priceCheckedAt: undefined, priceLastAttemptAt: undefined } }));
    }
    expect(save).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(connection.id)).toEqual(connection);
  });
});
