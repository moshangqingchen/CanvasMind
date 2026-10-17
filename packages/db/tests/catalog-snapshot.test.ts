import { mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import { FileRepository } from "../src/file.js";

const temporaryRoot = fileURLToPath(new URL("../../../.codex-temp/catalog-db-tests/", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(temporaryRoot) + sep)) throw new Error("Unexpected temporary test directory");
    await rm(directory, { recursive: true, force: true });
  }
});
async function testPath() {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "snapshot-"));
  directories.push(directory); return join(directory, "state.json");
}
async function seed(repository: MemoryRepository) {
  const supplier = await repository.saveSupplier({ id: "supplier", name: "Fixture supplier", supplierKey: "fixture",
    siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1", kind: "newapi", scanStatus: "live", scanComplete: true,
    catalog: { groups: [{ id: "group", label: "Group", models: [{ id: "full/model-id", capability: "image", priceLabel: "¥0.10/张 · 4K" }] }] } });
  const connection = await repository.saveConnection({ id: "connection", name: "Fixture key", provider: "openai", encryptedSecret: "opaque-fixture",
    config: { supplierId: supplier.id, modelCatalogModels: [{ id: "full/model-id", metadata: { priceLabel: "¥0.10/张 · 4K" } }] } });
  return { supplier, connection };
}
describe("atomic automatic catalog storage", () => {
  it("persists app settings with backward-compatible optional snapshot field", async () => {
    const path = await testPath(), repository = new FileRepository(path);
    await repository.setApplicationSetting("supplierCatalogCheckMode", "off");
    expect(await new FileRepository(path).getApplicationSetting("supplierCatalogCheckMode")).toBe("off");
    const restored = new MemoryRepository(repository.exportSnapshot());
    expect(await restored.getApplicationSetting("supplierCatalogCheckMode")).toBe("off");
    expect(await new MemoryRepository().getApplicationSetting("supplierCatalogCheckMode")).toBeUndefined();
  });
  it("publishes supplier and connection together through one durable replacement", async () => {
    const path = await testPath(); let writes = 0;
    const repository = new FileRepository(path, async (from, to) => { writes++; return rename(from, to); });
    const { supplier, connection } = await seed(repository); writes = 0;
    await repository.commitCatalogSnapshot({ expectedSupplier: supplier, expectedConnections: [connection],
      supplier: { ...supplier, scanStatus: "empty", catalog: { groups: [] } }, connections: [{ ...connection, config: { supplierId: supplier.id, modelCatalogModels: [] } }] });
    expect(writes).toBe(1);
    const disk = new FileRepository(path);
    expect((await disk.getSupplier(supplier.id))?.catalog.groups).toEqual([]);
    expect((await disk.getConnection(connection.id))?.config.modelCatalogModels).toEqual([]);
  });
  it("supplier or sibling connection edits reject all proposed writes", async () => {
    const repository = new MemoryRepository(), { supplier, connection } = await seed(repository);
    await repository.saveSupplier({ ...supplier, name: "Foreground edit" });
    await expect(repository.commitCatalogSnapshot({ expectedSupplier: supplier, expectedConnections: [connection],
      supplier: { ...supplier, name: "Stale automatic write" }, connections: [{ ...connection, name: "Must not publish" }] })).rejects.toThrow();
    expect((await repository.getConnection(connection.id))?.name).toBe(connection.name);
    expect((await repository.getSupplier(supplier.id))?.name).toBe("Foreground edit");
  });
  it("disk replacement failure leaves the entire original on-disk snapshot intact", async () => {
    const path = await testPath(); let fail = false;
    const repository = new FileRepository(path, async (from, to) => {
      if (fail) throw Object.assign(new Error("simulated-disk-error"), { code: "EIO" });
      return rename(from, to);
    });
    const { supplier, connection } = await seed(repository);
    const originalContents = await readFile(path, "utf8"); fail = true;
    await expect(repository.commitCatalogSnapshot({ expectedSupplier: supplier, expectedConnections: [connection],
      supplier: { ...supplier, catalog: { groups: [] } }, connections: [{ ...connection, config: { supplierId: supplier.id, modelCatalogModels: [] } }] })).rejects.toThrow("simulated-disk-error");
    expect(await readFile(path, "utf8")).toBe(originalContents);
    expect((await repository.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
    expect((await repository.getConnection(connection.id))?.config).toEqual(connection.config);
    const disk = new FileRepository(path);
    expect((await disk.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
    expect((await disk.getConnection(connection.id))?.config).toEqual(connection.config);
  });
  it("failed settings persist does not change live memory, and setting CAS rejects an off race", async () => {
    const path = await testPath(); let fail = false;
    const repository = new FileRepository(path, async (from, to) => {
      if (fail) throw Object.assign(new Error("settings-disk-error"), { code: "EIO" });
      return rename(from, to);
    });
    await repository.setApplicationSetting("mode", "daily"); fail = true;
    await expect(repository.setApplicationSetting("mode", "off")).rejects.toThrow("settings-disk-error");
    expect(await repository.getApplicationSetting("mode")).toBe("daily");
    expect(await new FileRepository(path).getApplicationSetting("mode")).toBe("daily");
    fail = false; const { supplier, connection } = await seed(repository);
    await repository.setApplicationSetting("mode", "off");
    await expect(repository.commitCatalogSnapshot({ expectedApplicationSettings: { mode: "daily" }, expectedSupplier: supplier,
      expectedConnections: [connection], supplier: { ...supplier, catalog: { groups: [] } }, connections: [] })).rejects.toThrow("设置已改变");
    expect((await repository.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
  });
  it("foreground saves admitted during a catalog disk write wait and retain their newer data", async () => {
    const path = await testPath(); let hold = false, entered!: () => void, release!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const repository = new FileRepository(path, async (from, to) => {
      if (hold) { entered(); await held; } return rename(from, to);
    });
    const { supplier, connection } = await seed(repository); hold = true;
    const automatic = repository.commitCatalogSnapshot({ expectedSupplier: supplier, supplier: { ...supplier, catalog: { groups: [] } },
      expectedConnections: [connection], connections: [connection] });
    await writing;
    expect((await repository.getSupplier(supplier.id))?.catalog).toEqual(supplier.catalog);
    const foreground = repository.saveConnection({ ...connection, name: "Foreground newer choice" });
    release(); await Promise.all([automatic, foreground]);
    expect((await repository.getConnection(connection.id))?.name).toBe("Foreground newer choice");
    expect((await new FileRepository(path).getConnection(connection.id))?.name).toBe("Foreground newer choice");
  });
});
