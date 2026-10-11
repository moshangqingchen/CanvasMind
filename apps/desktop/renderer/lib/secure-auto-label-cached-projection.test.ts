import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, network: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; }, jsonError: (message: string, status: number) => Response.json({ error: message }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.network, discoverSupplierCatalog: mocks.network, scanProviderModelCatalog: mocks.network }));
import { readProviderModelInventory } from "./provider-model-inventory";
const rawPath = process.env.SECURE_AUTO_LABEL_RAW_PATH, rawBytes = rawPath ? readFileSync(rawPath) : undefined;
const raw = rawBytes ? JSON.parse(rawBytes.toString("utf8")) as { sourceDatabaseSha256: string; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[] } : undefined;
const connectionId = "f17ec12d-2fde-4c7d-a72a-3f9a612fe947", fullModelId = "gpt-image-2";
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex");
const byteSha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
let proof: Record<string, unknown> | undefined;
afterEach(() => {
  expect(mocks.network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (proof && process.env.SECURE_AUTO_LABEL_PROOF_PATH) {
    const path = resolve(process.env.SECURE_AUTO_LABEL_PROOF_PATH);
    expect(path.startsWith(resolve("../../../.codex-temp/supplier-full-document-recheck-r8-20261010") + sep)).toBe(true);
    writeFileSync(path, JSON.stringify({ ...proof, passed: true, finalGuardCompleted: true }, null, 2) + "\n", { flag: "wx" });
  }
});
describe("Secure exact existing native-field auto display on actual frozen contracts", () => {
  it.skipIf(!rawPath)("projects the new label on cached-only reads and independently records whether ordinary model reads persist the display descriptor", async () => {
    expect(byteSha(rawBytes!)).toBe(process.env.SECURE_AUTO_LABEL_RAW_SHA256);
    expect(raw!.sourceDatabaseSha256).toBe(process.env.SECURE_AUTO_LABEL_DATABASE_SHA256);
    const actualConnection = raw!.connections.find(row => row.id === connectionId)!;
    const actualSupplier = raw!.suppliers.find(row => row.id === actualConnection.config.supplierId)!;
    expect(actualConnection.provider).toBe("openai"); expect(actualConnection.config.baseUrl).toBe("https://token.secure-skill.com/v1");
    expect(actualConnection.config.accountKeyGroup).toBe("image-2-1k");
    mocks.repository = new MemoryRepository(); mocks.network.mockReset().mockRejectedValue(new Error("No network in exact Secure display projection")); vi.stubGlobal("fetch", mocks.network);
    await mocks.repository.saveSupplier(structuredClone(actualSupplier)); await mocks.repository.saveConnection(structuredClone(actualConnection));
    const save = vi.spyOn(mocks.repository, "saveConnection"), before = (await mocks.repository.getConnection(connectionId))!, beforeSupplier = (await mocks.repository.getSupplier(actualSupplier.id))!;
    expect(before.config).toEqual(actualConnection.config);
    const read = (cached: boolean) => readProviderModelInventory(new Request(`http://localhost/api/providers/${connectionId}/models${cached ? "?cached=1" : ""}`), { params: Promise.resolve({ id: connectionId }) });
    const response = await read(true); expect(response.status).toBe(200); const cachedModels = await response.json() as ModelDescriptor[];
    const cachedModel = cachedModels.find(model => model.id === fullModelId)!;
    expect(cachedModel.parameters?.find(row => row.key === "size")?.options?.find(row => row.value === "auto")?.label).toBe("按独立档位与比例（未指定时供应商默认）");
    expect(save).not.toHaveBeenCalled(); expect(await mocks.repository.getConnection(connectionId)).toEqual(before);
    const stages: unknown[] = [], counts: number[] = [];
    for (let stage = 1; stage <= 3; stage++) {
      const current = (await mocks.repository.getConnection(connectionId))!; save.mockClear(); const ordinary = await read(false); expect(ordinary.status).toBe(200); const apiModels = await ordinary.json() as ModelDescriptor[];
      const after = (await mocks.repository.getConnection(connectionId))!; counts.push(save.mock.calls.length);
      stages.push({ stage, saveCount: save.mock.calls.length, configBefore: current.config, configAfter: after.config,
        beforeConfigCanonicalSha256: sha(current.config), afterConfigCanonicalSha256: sha(after.config), apiModels });
      if (stage === 3) { expect(save).not.toHaveBeenCalled(); expect(after).toEqual(current); }
    }
    const after = (await mocks.repository.getConnection(connectionId))!;
    expect(await mocks.repository.getSupplier(actualSupplier.id)).toEqual(beforeSupplier);
    const beforeModels = before.config.modelCatalogModels as unknown as ModelDescriptor[];
    const afterModels = after.config.modelCatalogModels as unknown as ModelDescriptor[];
    expect(afterModels.map(row => row.id)).toEqual(beforeModels.map(row => row.id));
    for (const model of beforeModels) {
      const saved = afterModels.find(row => row.id === model.id)!;
      expect(saved.pricing).toEqual(model.pricing); expect(saved.operations).toEqual(model.operations); expect(saved.limits).toEqual(model.limits);
      expect(saved.parameters?.map(row => ({ key: row.key, default: row.default, min: row.min, max: row.max, step: row.step, options: row.options?.map(option => option.value) })))
        .toEqual(model.parameters?.map(row => ({ key: row.key, default: row.default, min: row.min, max: row.max, step: row.step, options: row.options?.map(option => option.value) })));
    }
    proof = { sourceReplayIsNotInstalledApiEvidence: true, sourceReplayIsNotNewOfficialSampling: true, connectionId, supplierId: actualSupplier.id,
      origin: "https://token.secure-skill.com", group: "image-2-1k", fullModelId, sourceDatabaseSha256: raw!.sourceDatabaseSha256,
      rawSource: { path: rawPath, sha256: byteSha(rawBytes!) }, cachedModel, cachedApiLabelImmediatelyCorrect: true, cachedSaveCount: 0,
      cachedBeforeConfigCanonicalSha256: sha(before.config), cachedAfterConfigCanonicalSha256: sha(before.config), ordinaryGetSaveCounts: counts, stages,
      ordinaryPersistenceMayBeNecessaryForStableQaModelReads: counts.some(count => count > 0), thirdGetWholeConnectionIdempotent: true,
      supplierUnchanged: true, parameterValuesBoundsOptionsAndDefaultsUnchanged: true, pricesOperationsAndLimitsUnchanged: true,
      upstreamRequests: 0, applicationCalls: 0, liveProfileReads: 0, profileWrites: 0, mediaRequests: 0 };
  });
});
