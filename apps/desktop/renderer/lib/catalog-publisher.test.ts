import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, catalogObservationIdentity, type CatalogObservationCommit } from "@super-canvas/db";
import { createCatalogPublisher } from "./catalog-publisher";
afterEach(() => { vi.unstubAllGlobals(); });

async function fixture() {
  const repository = new MemoryRepository();
  const supplier = await repository.saveSupplier({ id: "publication-supplier", name: "Fixture", supplierKey: "fixture", siteUrl: "https://fixture.invalid",
    apiUrl: "https://fixture.invalid/v1", kind: "newapi", scanStatus: "unscanned", catalog: { groups: [{ id: "group-a", label: "Group A", models: [] }] } });
  const reservation = await repository.reserveCatalogObservation({ identity: catalogObservationIdentity(supplier), sourceKey: "catalog-source",
    observationCycleId: "cycle-1", expectedMode: "daily" });
  const input: CatalogObservationCommit = { reservation, groups: [{ kind: "fields", groupId: "name:group-a", fields: { expected: { label: "Group A" }, set: { label: "Updated A" } } }],
    state: [{ key: "receipt:fixture", value: { status: "completed" } }] };
  return { repository, supplier, input };
}
describe("catalog publication bridge", () => {
  it("defaults disabled and requires an explicit policy approval before calling storage", async () => {
    const { repository, input } = await fixture(), commit = vi.spyOn(repository, "commitCatalogObservation");
    await expect(createCatalogPublisher(repository).publish(input)).rejects.toThrow("尚未启用");
    await expect(createCatalogPublisher(repository, () => false).publish(input)).rejects.toThrow("策略校验");
    expect(commit).not.toHaveBeenCalled();
  });
  it("only calls the atomic typed commit and never ordinary saves or upstream requests", async () => {
    const { repository, supplier, input } = await fixture();
    const commit = vi.spyOn(repository, "commitCatalogObservation"), save = vi.spyOn(repository, "saveConnection"), settings = vi.spyOn(repository, "setApplicationSetting");
    const network = vi.fn(() => { throw new Error("Unexpected upstream request"); }); vi.stubGlobal("fetch", network);
    const result = await createCatalogPublisher(repository, () => true).publish(input);
    expect(commit).toHaveBeenCalledExactlyOnceWith(input); expect(save).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(result.entries["receipt:fixture"]).toEqual({ status: "completed" });
    expect((await repository.getSupplier(supplier.id))?.catalog.groups[0]?.label).toBe("Updated A");
  });
  it("copies input and validation arguments so neither caller nor validator changes the patch", async () => {
    const { repository, input } = await fixture();
    const publisher = createCatalogPublisher(repository, inspected => { inspected.state![0]!.value = { status: "mutated-policy" }; return true; });
    const work = publisher.publish(input); input.state![0]!.value = { status: "mutated-caller" };
    expect((await work).entries["receipt:fixture"]).toEqual({ status: "completed" });
  });
  it("shares a short per-supplier mutex across publisher instances and releases after rejection", async () => {
    const { repository, input } = await fixture();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const original = repository.commitCatalogObservation.bind(repository);
    const commit = vi.spyOn(repository, "commitCatalogObservation").mockImplementationOnce(async () => { entered(); await waiting; throw new Error("fixture commit rejected"); }).mockImplementation(original);
    const nextPolicy = vi.fn(() => true);
    const first = createCatalogPublisher(repository, () => true).publish(input).catch(error => error);
    await started;
    const second = createCatalogPublisher(repository, nextPolicy).publish(input);
    await Promise.resolve(); expect(nextPolicy).not.toHaveBeenCalled(); expect(commit).toHaveBeenCalledTimes(1);
    release(); expect((await first).message).toBe("fixture commit rejected");
    await second; expect(nextPolicy).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(2);
  });
  it("does not retry or rewrite a conflicted observation", async () => {
    const { repository, supplier, input } = await fixture();
    await repository.saveSupplier({ ...supplier, catalog: { groups: [{ ...supplier.catalog.groups[0]!, label: "Foreground label" }] } });
    const commit = vi.spyOn(repository, "commitCatalogObservation"), before = repository.exportSnapshot();
    await expect(createCatalogPublisher(repository, () => true).publish(input)).rejects.toThrow("目标字段已改变");
    expect(commit).toHaveBeenCalledTimes(1); expect(repository.exportSnapshot()).toEqual(before);
  });
  it("does not hold an unrelated supplier behind another supplier's short publication mutex", async () => {
    const { repository, supplier, input } = await fixture();
    const other = await repository.saveSupplier({ ...supplier, id: "other-supplier" });
    const reservation = await repository.reserveCatalogObservation({ identity: catalogObservationIdentity(other), sourceKey: "other-source",
      observationCycleId: "cycle-1", expectedMode: "daily" });
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const original = repository.commitCatalogObservation.bind(repository);
    vi.spyOn(repository, "commitCatalogObservation").mockImplementation(async candidate => {
      if (candidate.reservation.identity.supplierId === supplier.id) { entered(); await held; }
      return original(candidate);
    });
    const publisher = createCatalogPublisher(repository, () => true), first = publisher.publish(input); await started;
    const result = await publisher.publish({ reservation, state: [{ key: "receipt:other", value: { status: "completed" } }] });
    expect(result.entries["receipt:other"]).toEqual({ status: "completed" });
    release(); await first;
  });
});
