import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets, userImageSizeOptions } from "@super-canvas/providers/image-size-presets";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "./provider-model-inventory";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/mikoto-g5-whole-connection.json", import.meta.url), "utf8")) as {
  connection: ProviderConnectionRecord; supplier: SupplierRecord;
};
const ids = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const containers = ["modelCatalogModels", "connector", "modelProtocolTemplate"] as const;
const rows = (record: ProviderConnectionRecord, key: typeof containers[number]): ModelDescriptor[] => key === "modelCatalogModels"
  ? record.config[key] as unknown as ModelDescriptor[] : (record.config[key] as { models: ModelDescriptor[] }).models;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const changed = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) => Object.keys({ ...a, ...b })
  .filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const nonModelContract = (connection: ProviderConnectionRecord, key: typeof containers[number]) => key === "modelCatalogModels"
  ? null : { ...(connection.config[key] as object), models: undefined };
function delta(before: ProviderConnectionRecord, after: ProviderConnectionRecord) {
  return { configFields: changed(before.config, after.config), containers: Object.fromEntries(containers.map(key => [key, {
    beforeIds: rows(before, key).map(m => m.id), afterIds: rows(after, key).map(m => m.id),
    beforeSha256: sha(before.config[key]), afterSha256: sha(after.config[key]),
    nonModelContractChanged: sha(nonModelContract(before, key)) !== sha(nonModelContract(after, key)),
    modelChanges: rows(before, key).map(m => {
      const next = rows(after, key).find(n => n.id === m.id)!;
      const fields = changed(m as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
      return { id: m.id, fields, topLevel: Object.fromEntries(fields.filter(k => k !== "metadata").map(k => [k,
        { before: m[k as keyof ModelDescriptor], after: next[k as keyof ModelDescriptor] }])),
      metadata: Object.fromEntries(changed(m.metadata ?? {}, next.metadata ?? {}).map(k => [k, { before: m.metadata?.[k], after: next.metadata?.[k] }])) };
    }).filter(m => m.fields.length),
  }])) };
}
function assertOpen(rows: ModelDescriptor[]) {
  for (const id of ids.slice(1)) {
    const model = rows.find(m => m.id === id)!;
    const size = model.parameters?.find(p => p.key === "size");
    expect(size).toMatchObject({ control: "dimensions", step: 1, allowCustomValue: true });
    expect(size?.min).toBeUndefined(); expect(size?.max).toBeUndefined();
    expect(size?.options?.map(option => option.value)).toEqual(userImageSizeOptions(["1K"]).map(option => option.value));
    expect(model.metadata).toMatchObject({ imageUserSizePresetSource: "user-request", imageUserSizePresetTiers: ["1K"] });
    expect(model.parameters?.find(p => p.key === "size_tier")?.options?.map(o => o.value)).toEqual(["1K"]);
    expect(model.parameters?.find(p => p.key === "aspect_ratio")?.control).toBe("text");
    expect(model.parameters?.find(p => p.key === "quality")?.options?.map(o => o.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    expect(model.parameters?.find(p => p.key === "quality")?.default).toBe("max");
    expect(model.pricing).toMatchObject({ currency: "USD", unitAmount: .02 });
    expect(model.metadata?.supplierPriceGroupId).toBe("5");
  }
}
beforeEach(() => {
  mocks.repository = new MemoryRepository(); mocks.upstream.mockReset().mockRejectedValue(new Error("Saved g5 inventory must stay offline"));
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
describe("Mikoto group5 actual raw whole saved REST contract", () => {
  it("projects cached controls without writing raw models or calling upstream", async () => {
    const { supplier, connection, read } = await setup();
    const save = vi.spyOn(mocks.repository, "saveConnection"); const response = await read("?cached=1");
    expect(response.status).toBe(200); const api: ModelDescriptor[] = await response.json();
    expect(api.map(m => m.id)).toEqual(ids); assertOpen(api);
    expect(api[0]?.parameters).toEqual(applyUserImageSizePresets(rows(connection, "modelCatalogModels")[0]!).parameters);
    expect(save).not.toHaveBeenCalled(); expect(await mocks.repository.getConnection(connection.id)).toEqual(connection);
    expect(await mocks.repository.getSupplier(supplier.id)).toEqual(supplier);
  });
  it("persists both exact2.5 controls through catalog, connector and retained template, then remains idempotent", async () => {
    const { supplier, connection, read } = await setup(); const save = vi.spyOn(mocks.repository, "saveConnection");
    const stages = [connection]; const counts: number[] = [];
    for (let stage = 0; stage < 3; stage++) {
      save.mockClear(); const response = await read(); expect(response.status).toBe(200); assertOpen(await response.json());
      counts.push(save.mock.calls.length); stages.push((await mocks.repository.getConnection(connection.id))!);
      expect(await mocks.repository.getSupplier(supplier.id)).toEqual(supplier);
    }
    expect(counts).toEqual([1, 1, 0]);
    for (const stage of stages.slice(1)) {
      expect(changed(connection.config, stage.config).every(k => containers.includes(k as typeof containers[number]))).toBe(true);
      for (const key of containers) {
        expect(rows(stage, key).map(m => m.id)).toEqual(rows(connection, key).map(m => m.id));
        expect(nonModelContract(stage, key)).toEqual(nonModelContract(connection, key));
        const beforeGpt2 = rows(connection, key).find(m => m.id === "gpt-image-2")!;
        const afterGpt2 = rows(stage, key).find(m => m.id === "gpt-image-2")!;
        // The first retained template copies the previous connector. The
        // second GET brings only that template to the same user preset projection.
        const expectedGpt2 = key === "modelProtocolTemplate"
          ? rows(connection, "modelCatalogModels").find(m => m.id === "gpt-image-2")! : beforeGpt2;
        expect(afterGpt2.parameters).toEqual(key === "modelProtocolTemplate" && stage === stages[1]
          ? expectedGpt2.parameters : applyUserImageSizePresets(expectedGpt2).parameters);
        expect(afterGpt2.pricing?.unitAmount).toBe(key === "modelProtocolTemplate"
          ? rows(connection, "modelCatalogModels").find(m => m.id === "gpt-image-2")!.pricing?.unitAmount : beforeGpt2.pricing?.unitAmount);
      }
      assertOpen(rows(stage, "modelCatalogModels")); assertOpen(rows(stage, "connector"));
    }
    assertOpen(rows(stages[2]!, "modelProtocolTemplate"));
    expect(stages[3]).toEqual(stages[2]);
    if (process.env.MIKOTO_G5_WHOLE_PROOF_PATH) {
      const out = resolve(process.env.MIKOTO_G5_WHOLE_PROOF_PATH);
      const allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-b") + sep;
      if (!out.startsWith(allowed) || !out.endsWith(".json")) throw new Error("Only audit-b safe proof output is permitted");
      writeFileSync(out, JSON.stringify({ passed: true, fixture: "lib/fixtures/mikoto-g5-whole-connection.json", connectionId: connection.id,
        modelCount: 3, fullModelIds: ids, ordinarySavedBranchNetworkRequests: mocks.upstream.mock.calls.length,
        ordinaryGetSaveCounts: counts, firstGet: delta(stages[0]!, stages[1]!), secondGet: delta(stages[1]!, stages[2]!),
        thirdGet: delta(stages[2]!, stages[3]!), nodeParametersWritten: false, actualProfileWrites: 0 }, null, 2) + "\n");
    }
  });
});
