import { mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import { FileRepository } from "../src/file.js";
import { catalogObservationIdentity, catalogObservationGroupIdentity, catalogPipelineSettingKey, type CatalogObservationCommit, type CatalogObservationReservation } from "../src/catalog-observation.js";
import type { ProviderConnectionRecord, SupplierRecord } from "../src/types.js";

const temporaryRoot = fileURLToPath(new URL("../../../.codex-temp/catalog-observation-tests/", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(temporaryRoot) + sep)) throw new Error("Unexpected test directory");
    await rm(directory, { recursive: true, force: true });
  }
});
async function testPath() {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "observation-"));
  directories.push(directory); return join(directory, "state.json");
}
async function seed(repository: MemoryRepository) {
  const supplier = await repository.saveSupplier({ id: "supplier", name: "Fixture supplier", supplierKey: "fixture",
    siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1", kind: "newapi", scanStatus: "live", scanComplete: true,
    state: { version: 1, revision: 2, visibility: "visible", sourceId: "source-a", fingerprint: "same-source", history: [] },
    catalog: { groups: ["a", "b"].map(id => ({ id: `local-${id}`, supplierGroupId: `official-${id}`, label: id,
      models: [{ id: `model-${id}`, capability: "image" as const, priceLabel: "¥0.10/张" }] })) } });
  const connections = await Promise.all(["a", "b"].map(id => repository.saveConnection({ id: `connection-${id}`, name: `Key ${id}`,
    provider: "openai", encryptedSecret: `encrypted-fixture-${id}`, config: { supplierId: supplier.id, supplierSourceId: "source-a",
      accountKeyGroupId: `official-${id}`, baseUrl: supplier.apiUrl, defaultModel: `model-${id}`, modelCatalogModels: [{ id: `model-${id}`, price: "old" }],
      connector: { endpoint: "/images/generations", models: [{ id: `model-${id}` }] } } })));
  return { supplier, connections };
}
async function reserve(repository: MemoryRepository, supplier: SupplierRecord, connection: ProviderConnectionRecord, sourceKey = connection.id) {
  return repository.reserveCatalogObservation({ identity: catalogObservationIdentity(supplier, [connection]), sourceKey,
    observationCycleId: "day-1", expectedMode: "daily", initialEntries: { migration: { nextEligibleAt: "2026-10-18T00:00:00Z", paused: true } } });
}
function change(token: CatalogObservationReservation, connection: ProviderConnectionRecord): CatalogObservationCommit {
  return { reservation: token, groups: [{ kind: "fields", groupId: `site-id:${connection.config.accountKeyGroupId}`,
    fields: { expected: { models: [{ id: String(connection.config.defaultModel), capability: "image", priceLabel: "¥0.10/张" }] },
      set: { models: [{ id: String(connection.config.defaultModel), capability: "image", priceLabel: "¥0.20/张" }] } } }],
    connections: [{ connectionId: connection.id, fields: { expected: { modelCatalogModels: connection.config.modelCatalogModels }, set: { modelCatalogModels: [{ id: connection.config.defaultModel, price: "new" }] } } }],
    state: [{ key: `job:${token.sourceKey}`, value: { status: "completed", count: 1 } }] };
}
describe("catalog observation atomic storage", () => {
  it("accepts disjoint groups/sources against latest records without whole-supplier CAS", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository);
    const a = await reserve(repository, supplier, connections[0]!), b = await reserve(repository, supplier, connections[1]!);
    await repository.saveSupplier({ ...supplier, name: "Foreground name", state: { ...supplier.state!, revision: 90 } });
    await repository.saveConnection({ ...connections[1]!, name: "Foreground sibling name" });
    await Promise.all([repository.commitCatalogObservation(change(a, connections[0]!)), repository.commitCatalogObservation(change(b, connections[1]!))]);
    const current = await repository.getSupplier(supplier.id);
    expect(current?.name).toBe("Foreground name"); expect(current?.state?.revision).toBe(90);
    expect(current?.catalog.groups.map(group => group.models[0]?.priceLabel)).toEqual(["¥0.20/张", "¥0.20/张"]);
    expect((await repository.getConnection(connections[1]!.id))?.name).toBe("Foreground sibling name");
    const state = await repository.getApplicationSetting(catalogPipelineSettingKey(supplier.id));
    expect(state).toMatchObject({ schemaVersion: 1, nextDispatchSeq: 3, entries: { migration: { paused: true }, "job:connection-a": { count: 1 }, "job:connection-b": { count: 1 } } });
  });
  it("rejects same-field changes and the matching state patch together", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), connection = connections[0]!;
    const token = await reserve(repository, supplier, connection);
    await repository.saveConnection({ ...connection, config: { ...connection.config, modelCatalogModels: [{ id: "manual-newer" }] } });
    await expect(repository.commitCatalogObservation(change(token, connection))).rejects.toThrow("目标字段已改变");
    expect((await repository.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
    expect(await repository.getApplicationSetting(catalogPipelineSettingKey(supplier.id))).not.toHaveProperty("entries.job:connection-a");
  });
  it.each(["site", "secret", "group", "source", "archive", "login", "mode", "manual-supplier", "manual-key", "manual-time"])("rejects identity/config changes: %s", async kind => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), connection = connections[0]!;
    const token = await reserve(repository, supplier, connection);
    if (kind === "site") await repository.saveSupplier({ ...supplier, apiUrl: "https://different.invalid/v1" });
    if (kind === "secret") await repository.saveConnection({ ...connection, encryptedSecret: "new-encrypted-fixture" });
    if (kind === "group") await repository.saveConnection({ ...connection, config: { ...connection.config, accountKeyGroupId: "different" } });
    if (kind === "source") await repository.saveSupplier({ ...supplier, state: { ...supplier.state!, sourceId: "source-b" } });
    if (kind === "archive") await repository.saveSupplier({ ...supplier, state: { ...supplier.state!, visibility: "deleted" } });
    if (kind === "login") await repository.saveSupplier({ ...supplier, state: { ...supplier.state!, siteLogin: { authMode: "password", username: "fixture", encryptedPassword: "opaque" , siteUrl: supplier.siteUrl } } });
    if (kind === "mode") await repository.setApplicationSetting("supplierCatalogCheckMode", "off");
    if (kind === "manual-supplier") await repository.saveSupplier({ ...supplier, state: { ...supplier.state!, scanId: "manual-newer" } });
    if (kind === "manual-key") await repository.saveConnection({ ...connection, config: { ...connection.config, modelScanRequestId: "manual-newer" } });
    if (kind === "manual-time") await repository.saveConnection({ ...connection, config: { ...connection.config, modelScanCheckedAt: "2026-10-18T00:00:00Z" } });
    await expect(repository.commitCatalogObservation(change(token, connection))).rejects.toThrow();
    expect((await repository.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
  });
  it("disabled checks cannot reserve and leave no namespace", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository);
    await repository.setApplicationSetting("supplierCatalogCheckMode", "off");
    await expect(reserve(repository, supplier, connections[0]!)).rejects.toThrow("设置已改变");
    expect(await repository.getApplicationSetting(catalogPipelineSettingKey(supplier.id))).toBeUndefined();
  });
  it("later dispatch or accepted result supersedes old seq and duplicate application", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), connection = connections[0]!;
    const old = await reserve(repository, supplier, connection), newer = await reserve(repository, supplier, connection);
    expect(newer.dispatchSeq).toBe(old.dispatchSeq + 1);
    await expect(repository.commitCatalogObservation(change(old, connection))).rejects.toThrow("更新的请求替代");
    await repository.commitCatalogObservation(change(newer, connection));
    await expect(repository.commitCatalogObservation(change(newer, connection))).rejects.toThrow("更新的请求替代");
  });
  it("explicit identity invalidation rejects previous receipts without resetting monotonic seq", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository);
    const old = await reserve(repository, supplier, connections[0]!);
    const manual = await repository.reserveCatalogObservation({ identity: catalogObservationIdentity(supplier, connections), sourceKey: "manual-refresh",
      observationCycleId: "manual-1", expectedMode: "daily", invalidatePrevious: true });
    expect(manual.dispatchSeq).toBe(2); expect(manual.identityEpoch).not.toBe(old.identityEpoch);
    await expect(repository.commitCatalogObservation(change(old, connections[0]!))).rejects.toThrow("更新的请求替代");
  });
  it("entry CAS conflicts cannot publish catalogs or accepted source seq", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), connection = connections[0]!;
    const token = await reserve(repository, supplier, connection);
    const input = change(token, connection); input.state![0]!.expected = { status: "not-current" };
    const before = repository.exportSnapshot();
    await expect(repository.commitCatalogObservation(input)).rejects.toThrow("任务或计数已改变");
    expect(repository.exportSnapshot()).toEqual(before);
  });
  it("limits patches to known owned fields and retains ledger evidence", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), connection = connections[0]!;
    const token = await reserve(repository, supplier, connection), input = change(token, connection);
    input.connections![0]!.fields!.set = { defaultModel: "forbidden" } as never;
    await expect(repository.commitCatalogObservation(input)).rejects.toThrow("非所有权字段");
    const unknown = { ...input, connections: [{ connectionId: "unguarded" }] };
    await expect(repository.commitCatalogObservation(unknown)).rejects.toThrow();
  });
  it("patches nested model lists without replacing caller's endpoints or user values", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), connection = connections[0]!;
    const token = await reserve(repository, supplier, connection);
    await repository.commitCatalogObservation({ reservation: token, connections: [{ connectionId: connection.id,
      connectorModels: { expected: (connection.config.connector as { models: unknown }).models, value: [{ id: "new-model" }] } }] });
    const row = await repository.getConnection(connection.id);
    expect(row?.config.connector).toEqual({ endpoint: "/images/generations", models: [{ id: "new-model" }] });
    expect(row?.config.defaultModel).toBe("model-a");
  });
  it("projects the actual inventory status fields and preserves independent measured evidence", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), original = connections[0]!;
    const connection = await repository.saveConnection({ ...original, config: { ...original.config,
      measuredPriceEvidence: { requestId: "fixture-measured-record", amount: 0.31 }, ledger: { observedAt: "old-measurement" } } });
    const token = await reserve(repository, supplier, connection);
    const checkedAt = "2026-10-17T03:00:00Z";
    await repository.commitCatalogObservation({ reservation: token, connections: [{ connectionId: connection.id, fields: {
      expected: {}, set: { modelScanCheckedAt: checkedAt, modelScanLastSuccessAt: checkedAt,
        modelScanAttemptStatus: "live", modelScanGroups: ["official-a"], modelScanHttpStatus: null, modelScanUpstreamErrorCode: null },
    } }] });
    const current = (await repository.getConnection(connection.id))!;
    expect(current.config).toMatchObject({ modelScanCheckedAt: checkedAt, modelScanLastSuccessAt: checkedAt,
      modelScanAttemptStatus: "live", modelScanGroups: ["official-a"], modelScanHttpStatus: null, modelScanUpstreamErrorCode: null,
      measuredPriceEvidence: connection.config.measuredPriceEvidence, ledger: connection.config.ledger });
    const forbidden = await reserve(repository, supplier, current);
    await expect(repository.commitCatalogObservation({ reservation: forbidden, connections: [{ connectionId: connection.id,
      fields: { expected: {}, set: { modelScannedAt: checkedAt } as never } }] })).rejects.toThrow("非所有权字段");
  });
  it("keeps name/official group namespaces distinct and never deletes measured evidence", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository), connection = connections[0]!;
    const ledger = { amount: 0.31, currency: "CNY", unit: "image" as const, checkedAt: "2026-10-10T00:00:00Z", observedAt: "2026-10-10T00:00:00Z",
      sourceUrl: "https://fixture.invalid/ledger", supplierGroupId: "official-a", modelId: "model-a", resolution: "4K", parameters: { n: 1, resolution: "4K" }, sample: true as const, billingMode: "observed" };
    const updated = await repository.saveSupplier({ ...supplier, catalog: { groups: [
      { ...supplier.catalog.groups[0]!, details: { source: "model-plaza", referencePrice: "old reference", ledgerPrices: [ledger] } },
      ...supplier.catalog.groups.slice(1), { id: "official-a", label: "Numeric-looking local name", models: [] },
    ] } });
    const token = await reserve(repository, updated, connection);
    await repository.commitCatalogObservation({ reservation: token, groups: [
      { kind: "fields", groupId: catalogObservationGroupIdentity(updated.catalog.groups[0]!), details: { expected: { referencePrice: "old reference" }, set: { referencePrice: undefined } } },
      { kind: "fields", groupId: "name:official-a", fields: { expected: { label: "Numeric-looking local name" }, set: { label: "Local name survives independently" } } },
    ] });
    const current = (await repository.getSupplier(supplier.id))!;
    expect(current.catalog.groups[0]?.details?.ledgerPrices).toEqual([ledger]);
    expect(current.catalog.groups[0]?.details).not.toHaveProperty("referencePrice");
    expect(current.catalog.groups[2]?.label).toBe("Local name survives independently");
    const deletion = await reserve(repository, current, connection);
    await expect(repository.commitCatalogObservation({ reservation: deletion, groups: [{ kind: "remove", groupId: "site-id:official-a", expected: current.catalog.groups[0]! }] })).rejects.toThrow("实测证据");
  });
  it("rejects duplicate stable group identities and invalid namespace schemas", async () => {
    const repository = new MemoryRepository(), { supplier, connections } = await seed(repository);
    const duplicate = await repository.saveSupplier({ ...supplier, catalog: { groups: [supplier.catalog.groups[0]!, { ...supplier.catalog.groups[0]!, id: "other-local-name" }] } });
    const token = await reserve(repository, duplicate, connections[0]!);
    await expect(repository.commitCatalogObservation(change(token, connections[0]!))).rejects.toThrow("分组身份不唯一");
    await repository.setApplicationSetting(catalogPipelineSettingKey(supplier.id), { schemaVersion: 999 });
    await expect(reserve(repository, duplicate, connections[0]!)).rejects.toThrow("状态格式无效");
  });
  it("serializes concurrent disjoint FileRepository observations without sibling conflicts", async () => {
    const path = await testPath(), repository = new FileRepository(path), { supplier, connections } = await seed(repository);
    const [a, b] = await Promise.all([reserve(repository, supplier, connections[0]!), reserve(repository, supplier, connections[1]!)]);
    expect([a.dispatchSeq, b.dispatchSeq].sort()).toEqual([1, 2]);
    await Promise.all([repository.commitCatalogObservation(change(a, connections[0]!)), repository.commitCatalogObservation(change(b, connections[1]!))]);
    const disk = new FileRepository(path);
    expect((await disk.getSupplier(supplier.id))?.catalog.groups.map(group => group.models[0]?.priceLabel)).toEqual(["¥0.20/张", "¥0.20/张"]);
    expect(await disk.getApplicationSetting(catalogPipelineSettingKey(supplier.id))).toMatchObject({ nextDispatchSeq: 3, entries: { "job:connection-a": { count: 1 }, "job:connection-b": { count: 1 } } });
  });
  it("one durable rename publishes directory and queue/counter state together", async () => {
    const path = await testPath(); let writes = 0;
    const repository = new FileRepository(path, async (from, to) => { writes++; return rename(from, to); });
    const { supplier, connections } = await seed(repository), token = await reserve(repository, supplier, connections[0]!); writes = 0;
    await repository.commitCatalogObservation(change(token, connections[0]!));
    expect(writes).toBe(1);
    const disk = new FileRepository(path);
    expect((await disk.getSupplier(supplier.id))?.catalog.groups[0]?.models[0]?.priceLabel).toBe("¥0.20/张");
    expect(await disk.getApplicationSetting(catalogPipelineSettingKey(supplier.id))).toMatchObject({ entries: { "job:connection-a": { count: 1 } }, sources: { "connection-a": { lastAcceptedSeq: token.dispatchSeq } } });
  });
  it.each(["reserve", "publish"])("rename failure leaves both disk and memory unchanged: %s", async phase => {
    const path = await testPath(); let fail = false;
    const repository = new FileRepository(path, async (from, to) => { if (fail) throw Object.assign(new Error("fixture-rename-error"), { code: "EIO" }); return rename(from, to); });
    const { supplier, connections } = await seed(repository), token = await reserve(repository, supplier, connections[0]!);
    const beforeDisk = await readFile(path, "utf8"), beforeMemory = repository.exportSnapshot(); fail = true;
    await expect(phase === "publish" ? repository.commitCatalogObservation(change(token, connections[0]!)) : reserve(repository, supplier, connections[0]!)).rejects.toThrow("fixture-rename-error");
    expect(await readFile(path, "utf8")).toBe(beforeDisk); expect(repository.exportSnapshot()).toEqual(beforeMemory);
  });
  it("foreground saves wait behind publication and preserve their changes", async () => {
    const path = await testPath(); let hold = false, entered!: () => void, release!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const repository = new FileRepository(path, async (from, to) => { if (hold) { entered(); await held; } return rename(from, to); });
    const { supplier, connections } = await seed(repository), connection = connections[0]!, token = await reserve(repository, supplier, connection); hold = true;
    const automatic = repository.commitCatalogObservation(change(token, connection)); await writing;
    const foreground = repository.saveConnection({ ...connection, name: "Foreground name survives" });
    expect((await repository.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
    release(); await Promise.all([automatic, foreground]);
    expect((await repository.getConnection(connection.id))?.name).toBe("Foreground name survives");
    expect((await new FileRepository(path).getConnection(connection.id))?.name).toBe("Foreground name survives");
    expect((await new FileRepository(path).getSupplier(supplier.id))?.catalog.groups[0]?.models[0]?.priceLabel).toBe("¥0.20/张");
  });
});
