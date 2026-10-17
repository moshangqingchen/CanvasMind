import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import { catalogLegacyObservationOwner, catalogObservationIdentity, catalogPipelineSettingKey } from "../src/catalog-observation.js";

async function fixture() {
  const repository = new MemoryRepository();
  const connection = await repository.saveConnection({ id: "legacy-fixture", name: "Legacy fixture", provider: "openai", encryptedSecret: "opaque-fixture",
    config: { baseUrl: "http://127.0.0.1:9876/v1", defaultModel: "kept", modelCatalogModels: [{ id: "kept" }] } });
  const owner = catalogLegacyObservationOwner(connection), identity = catalogObservationIdentity(owner, [connection]);
  return { repository, connection, owner, identity };
}
describe("legacy catalog namespace anchors", () => {
  it("publishes a guarded independent connection without inserting a supplier or changing user parameters", async () => {
    const { repository, connection, owner, identity } = await fixture();
    const token = await repository.reserveCatalogObservation({ identity, sourceKey: "key-source", observationCycleId: "daily-1", expectedMode: "daily" });
    await repository.commitCatalogObservation({ reservation: token, connections: [{ connectionId: connection.id,
      fields: { expected: { scannedModelIds: undefined }, set: { scannedModelIds: ["kept", "new"] } } }],
      state: [{ key: "membership", value: { accepted: ["kept", "new"] } }] });
    expect(await repository.listSuppliers()).toEqual([]);
    expect((await repository.getConnection(connection.id))?.config.defaultModel).toBe("kept");
    expect(await repository.getApplicationSetting(catalogPipelineSettingKey(owner.id))).toMatchObject({ sources: { "key-source": { lastAcceptedSeq: 1 } } });
    await expect(repository.commitCatalogObservation({ reservation: await repository.reserveCatalogObservation({ identity, sourceKey: "bad", observationCycleId: "daily-1", expectedMode: "daily" }),
      supplierFields: { expected: { scanStatus: "unscanned" }, set: { scanStatus: "live" } } })).rejects.toThrow("独立连接不能发布供应商补丁");
  });
  it("rejects a legacy result after the connection is assigned a supplier", async () => {
    const { repository, connection, identity } = await fixture();
    const token = await repository.reserveCatalogObservation({ identity, sourceKey: "key-source", observationCycleId: "daily-1", expectedMode: "daily" });
    await repository.saveConnection({ ...connection, config: { ...connection.config, supplierId: "new-owner" } });
    await expect(repository.commitCatalogObservation({ reservation: token })).rejects.toThrow();
  });
  it("requires an explicit manual reservation when automatic mode is off", async () => {
    const { repository, identity } = await fixture();
    await repository.setApplicationSetting("supplierCatalogCheckMode", "off");
    const request = { identity, sourceKey: "key-source", observationCycleId: "manual-1", expectedMode: "off" as const };
    await expect(repository.reserveCatalogObservation(request)).rejects.toThrow("自动检查设置");
    const token = await repository.reserveCatalogObservation({ ...request, manual: true });
    await repository.commitCatalogObservation({ reservation: token, state: [{ key: "manual", value: { complete: true } }] });
  });
  it("rejects embedded URL credentials instead of persisting them in a virtual owner", async () => {
    const { connection } = await fixture();
    expect(() => catalogLegacyObservationOwner({ ...connection, config: { baseUrl: "https://user:secret@fixture.invalid/v1" } })).toThrow("独立连接来源无效");
  });
  it("rejects an expired publication deadline and its state patch together", async () => {
    const { repository, owner, identity } = await fixture();
    const reservation = await repository.reserveCatalogObservation({ identity, sourceKey: "key-source", observationCycleId: "daily-1", expectedMode: "daily" });
    await expect(repository.commitCatalogObservation({ reservation, leaseDeadline: Date.now() - 1,
      state: [{ key: "job", value: { complete: true } }] })).rejects.toThrow("租约已失效");
    expect(await repository.getApplicationSetting(catalogPipelineSettingKey(owner.id))).not.toHaveProperty("entries.job");
  });
});
