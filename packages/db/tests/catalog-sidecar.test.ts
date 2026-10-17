import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileRepository } from "../src/file.js";
import { MemoryRepository } from "../src/memory.js";
import { catalogObservationIdentity, catalogPipelineSettingKey } from "../src/catalog-observation.js";
import { CATALOG_STORAGE_SETTING, catalogSidecarDirectory, catalogSidecarPath } from "../src/catalog-sidecar.js";

const syncFailure = vi.hoisted(() => ({ mainPath: "", stage: "", sidecarWrites: 0 }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const file = await actual.open(...args), target = String(args[0]);
    if (args[1] !== "w" || !syncFailure.mainPath) return file;
    const main = target.startsWith(`${syncFailure.mainPath}.${process.pid}.`);
    if (!main) syncFailure.sidecarWrites++;
    const fail = syncFailure.stage === "main" ? main : !main && syncFailure.sidecarWrites === (syncFailure.stage === "prepare" ? 1 : 2);
    if (fail) file.sync = async () => { throw Object.assign(new Error("fixture-fsync-error"), { code: "EIO" }); };
    return file;
  } };
});

const root = fileURLToPath(new URL("../../../.codex-temp/catalog-sidecar-tests/", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  syncFailure.mainPath = ""; syncFailure.stage = ""; syncFailure.sidecarWrites = 0;
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(resolve(root) + sep)) throw new Error("Unsafe test cleanup");
    await rm(path, { recursive: true, force: true });
  }
});
async function pathFor() {
  await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, "sidecar-"));
  directories.push(directory); return join(directory, "super-canvas.json");
}
async function seed(repository: MemoryRepository) {
  const supplier = await repository.saveSupplier({ id: "supplier:../fixture", name: "Fixture", supplierKey: "fixture",
    siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1", kind: "newapi", scanStatus: "live", catalog: { groups: [] } });
  const connection = await repository.saveConnection({ id: "connection", provider: "openai", name: "Fixture Key",
    encryptedSecret: "fictional-secret", config: { supplierId: supplier.id, baseUrl: supplier.apiUrl, scannedModelIds: ["old"] } });
  const identity = catalogObservationIdentity(supplier, [connection]);
  return { supplier, connection, identity };
}
async function reserve(repository: MemoryRepository, identity: ReturnType<typeof catalogObservationIdentity>) {
  return repository.reserveCatalogObservation({ identity, sourceKey: "key", observationCycleId: "cycle", expectedMode: "daily" });
}
const disk = async (path: string) => JSON.parse(await readFile(path, "utf8")) as { applicationSettings: Record<string, unknown> };
const crash = () => Object.assign(new Error("fixture-crash"), { code: "EIO" });

describe("per-supplier catalog storage", () => {
  it("keeps full namespaces and notice cursors out of every foreground save, with bounded main markers", async () => {
    const path = await pathFor(), writes: string[] = [], repository = new FileRepository(path, async (from, to) => {
      writes.push(String(to)); return rename(from, to);
    });
    const { supplier, identity } = await seed(repository), token = await reserve(repository, identity);
    const key = catalogPipelineSettingKey(supplier.id);
    await repository.updateCatalogPipelineState({ identity, expectedMode: "daily", state: [{ key: "large", value: { payload: "x".repeat(500_000) } }] });
    await repository.setApplicationSetting("supplier-catalog-pipeline-notice-cursors:v1", { "fixture/change": 7 });
    const beforeMarker = (await disk(path)).applicationSettings[CATALOG_STORAGE_SETTING];
    writes.length = 0;
    await repository.updateCatalogPipelineState({ identity, expectedMode: "daily", state: [{ key: "queue", value: { status: "deferred" } }] });
    expect(writes).toEqual([catalogSidecarPath(path, key)]);
    expect((await disk(path)).applicationSettings[CATALOG_STORAGE_SETTING]).toEqual(beforeMarker);
    writes.length = 0;
    await repository.saveCanvas({ id: "canvas", title: "Fixture", graph: { nodes: [], edges: [] }, reason: "autosave" });
    expect(writes).toEqual([path]);
    const main = await readFile(path, "utf8"); expect(main.length).toBeLessThan(10_000);
    expect(main).not.toContain("x".repeat(100));
    expect((await disk(path)).applicationSettings[key]).toBeUndefined();
    const reopened = new FileRepository(path);
    expect(await reopened.getCatalogPipelineState(supplier.id)).toMatchObject({ nextDispatchSeq: token.dispatchSeq + 1,
      entries: { large: { payload: "x".repeat(500_000) }, queue: { status: "deferred" } } });
    expect(await reopened.getApplicationSetting("supplier-catalog-pipeline-notice-cursors:v1")).toEqual({ "fixture/change": 7 });
    expect((await readdir(catalogSidecarDirectory(path))).every(name => /^[a-f0-9]{64}\.json$/u.test(name))).toBe(true);
  });

  it.each(["prepare-before", "prepare-after", "main-before", "main-after", "finalize-before", "finalize-after"] as const)(
    "recovers observation at %s without replaying counters or applying an old result", async point => {
      const path = await pathFor(); let armed = false, sidecarWrites = 0;
      const repository = new FileRepository(path, async (from, to) => {
        const main = String(to) === path;
        if (armed && !main) sidecarWrites++;
        const match = armed && (point.startsWith("main") ? main : !main && sidecarWrites === (point.startsWith("prepare") ? 1 : 2));
        if (match && point.endsWith("before")) throw crash();
        await rename(from, to);
        if (match && point.endsWith("after")) throw crash();
      });
      const { supplier, connection, identity } = await seed(repository), token = await reserve(repository, identity);
      const change = { reservation: token, connections: [{ connectionId: connection.id,
        fields: { expected: { scannedModelIds: ["old"] }, set: { scannedModelIds: ["new"] } } }],
        state: [{ key: "accepted", value: { count: 1 } }] };
      armed = true; await expect(repository.commitCatalogObservation(change)).rejects.toThrow("fixture-crash");
      const committed = point === "main-after" || point.startsWith("finalize");
      const reopened = new FileRepository(path);
      expect((await reopened.getConnection(connection.id))?.config.scannedModelIds).toEqual(committed ? ["new"] : ["old"]);
      const state = await reopened.getCatalogPipelineState(supplier.id);
      expect(state?.sources.key?.lastAcceptedSeq).toBe(committed ? token.dispatchSeq : 0);
      expect(state?.entries.accepted).toEqual(committed ? { count: 1 } : undefined);
      await reopened.flush();
      expect((await new FileRepository(path).getCatalogPipelineState(supplier.id))?.sources).toEqual(state?.sources);
      if (committed) {
        // Retrying after an ambiguous return cannot charge a second observation.
        await expect(reopened.commitCatalogObservation(change)).rejects.toThrow();
        expect(await repository.getCatalogPipelineState(supplier.id)).toMatchObject({ entries: { accepted: { count: 1 } } });
      }
    });

  it.each(["prepare-before", "prepare-after", "main-before", "main-after", "finalize-before", "finalize-after"] as const)(
    "migrates old inline states idempotently after %s", async point => {
      const path = await pathFor(), memory = new MemoryRepository(), { supplier, identity } = await seed(memory);
      await reserve(memory, identity);
      await memory.setApplicationSetting("supplier-catalog-pipeline-notice-cursors:v1", { "fixture/change": 4 });
      const before = memory.exportSnapshot(); await writeFile(path, JSON.stringify(before), "utf8");
      let armed = true, sidecarWrites = 0;
      const repository = new FileRepository(path, async (from, to) => {
        const main = String(to) === path; if (armed && !main) sidecarWrites++;
        // Migration prepares two keys, then writes the one main snapshot.
        const match = armed && (point.startsWith("main") ? main : !main && sidecarWrites === (point.startsWith("prepare") ? 1 : 3));
        if (match && point.endsWith("before")) throw crash();
        await rename(from, to); if (match && point.endsWith("after")) throw crash();
      });
      await expect(repository.flush()).rejects.toThrow("fixture-crash"); armed = false;
      const reopened = new FileRepository(path);
      expect(await reopened.getCatalogPipelineState(supplier.id)).toEqual(await memory.getCatalogPipelineState(supplier.id));
      expect(await reopened.getApplicationSetting("supplier-catalog-pipeline-notice-cursors:v1")).toEqual({ "fixture/change": 4 });
      await reopened.flush(); const once = await disk(path);
      expect(once.applicationSettings[catalogPipelineSettingKey(supplier.id)]).toBeUndefined();
      expect(once.applicationSettings["supplier-catalog-pipeline-notice-cursors:v1"]).toBeUndefined();
      await new FileRepository(path).flush(); expect(await disk(path)).toEqual(once);
      // The old MemoryRepository accepts the additive v2 format and opaque marker.
      const old = new MemoryRepository(once as unknown as ReturnType<MemoryRepository["exportSnapshot"]>);
      expect((await old.listConnections()).length).toBe(1);
      expect((await disk(path)).applicationSettings.supplierCatalogCheckMode).toEqual(before.applicationSettings?.supplierCatalogCheckMode);
    });

  it.each(["missing", "invalid-json", "changed-evidence", "wrong-anchor"])("fails closed on %s sidecars", async damage => {
    const path = await pathFor(), repository = new FileRepository(path), { supplier, identity } = await seed(repository);
    await reserve(repository, identity); const target = catalogSidecarPath(path, catalogPipelineSettingKey(supplier.id));
    if (damage === "missing") await unlink(target);
    else if (damage === "invalid-json") await writeFile(target, "{", "utf8");
    else {
      const document = JSON.parse(await readFile(target, "utf8"));
      if (damage === "changed-evidence") document.committed.value.nextDispatchSeq = 900;
      else document.committed.anchor.transactionId = "unrelated";
      await writeFile(target, JSON.stringify(document), "utf8");
    }
    const main = await readFile(path, "utf8");
    expect(() => new FileRepository(path)).toThrow("已停止写入");
    expect(await readFile(path, "utf8")).toBe(main);
  });

  it("separates two database files in one directory", async () => {
    const path = await pathFor(), second = join(resolve(path, ".."), "other.json");
    const a = new FileRepository(path), b = new FileRepository(second);
    const left = await seed(a), right = await seed(b);
    await reserve(a, left.identity);
    await b.updateCatalogPipelineState({ identity: right.identity, expectedMode: "daily", state: [{ key: "other", value: { unique: true } }] });
    expect((await new FileRepository(path).getCatalogPipelineState(left.supplier.id))?.entries.other).toBeUndefined();
    expect((await new FileRepository(second).getCatalogPipelineState(right.supplier.id))?.entries.other).toEqual({ unique: true });
  });

  it("rejects an old client recreating inline namespaces after storage migration", async () => {
    const path = await pathFor(), repository = new FileRepository(path), { supplier, identity } = await seed(repository);
    await reserve(repository, identity);
    const snapshot = await disk(path);
    snapshot.applicationSettings[catalogPipelineSettingKey(supplier.id)] = await repository.getCatalogPipelineState(supplier.id);
    await writeFile(path, JSON.stringify(snapshot), "utf8");
    expect(() => new FileRepository(path)).toThrow("已停止写入");
  });

  it.each(["before", "after"])("recovers a state-only %s-rename failure without changing the main marker", async phase => {
    const path = await pathFor(); let armed = false;
    const repository = new FileRepository(path, async (from, to) => {
      if (armed && phase === "before") throw crash();
      await rename(from, to); if (armed && phase === "after") throw crash();
    });
    const { supplier, identity } = await seed(repository), token = await reserve(repository, identity);
    const before = await readFile(path, "utf8"); armed = true;
    await expect(repository.updateCatalogPipelineState({ identity, expectedMode: "daily", state: [{ key: "queue", value: { status: "running" } }] })).rejects.toThrow("fixture-crash");
    expect(await readFile(path, "utf8")).toBe(before);
    const reopened = new FileRepository(path), state = await reopened.getCatalogPipelineState(supplier.id);
    expect(state?.entries.queue).toEqual(phase === "after" ? { status: "running" } : undefined);
    expect(state?.nextDispatchSeq).toBe(token.dispatchSeq + 1);
    expect(state?.sources.key?.lastAcceptedSeq).toBe(0);
    expect(await repository.getCatalogPipelineState(supplier.id)).toEqual(state);
    await reopened.flush();
  });

  it("does not rewrite siblings during queue updates or foreground saves", async () => {
    const path = await pathFor(), writes: string[] = [], repository = new FileRepository(path, async (from, to) => {
      writes.push(String(to)); return rename(from, to);
    });
    const first = await seed(repository), secondSupplier = await repository.saveSupplier({ ...first.supplier, id: "second-supplier" });
    const secondConnection = await repository.saveConnection({ ...first.connection, id: "second-connection", config: { ...first.connection.config, supplierId: secondSupplier.id } });
    await reserve(repository, first.identity);
    await reserve(repository, catalogObservationIdentity(secondSupplier, [secondConnection]));
    const siblingPath = catalogSidecarPath(path, catalogPipelineSettingKey(secondSupplier.id)), sibling = await readFile(siblingPath, "utf8");
    writes.length = 0;
    await repository.updateCatalogPipelineState({ identity: first.identity, expectedMode: "daily", state: [{ key: "queue", value: { status: "ready" } }] });
    await repository.saveCanvas({ id: "foreground", graph: { nodes: [], edges: [] }, reason: "autosave" });
    expect(writes).toEqual([catalogSidecarPath(path, catalogPipelineSettingKey(first.supplier.id)), path]);
    expect(await readFile(siblingPath, "utf8")).toBe(sibling);
  });

  it("flush drains a main-committed pending finalization before acknowledging exit", async () => {
    const path = await pathFor(); let armed = false, sidecarWrites = 0;
    const repository = new FileRepository(path, async (from, to) => {
      if (armed && String(to) !== path && ++sidecarWrites === 2) throw crash();
      return rename(from, to);
    });
    const { supplier, connection, identity } = await seed(repository), token = await reserve(repository, identity);
    armed = true;
    await expect(repository.commitCatalogObservation({ reservation: token, connections: [{ connectionId: connection.id,
      fields: { expected: { scannedModelIds: ["old"] }, set: { scannedModelIds: ["new"] } } }], state: [{ key: "result", value: { count: 1 } }] })).rejects.toThrow("fixture-crash");
    armed = false; await repository.flush();
    const document = JSON.parse(await readFile(catalogSidecarPath(path, catalogPipelineSettingKey(supplier.id)), "utf8"));
    expect(document.prepared).toBeUndefined();
    const reopened = new FileRepository(path);
    expect((await reopened.getConnection(connection.id))?.config.scannedModelIds).toEqual(["new"]);
    expect((await reopened.getCatalogPipelineState(supplier.id))?.entries.result).toEqual({ count: 1 });
  });

  it.each(["prepare", "main", "finalize"])("recovers after a %s file fsync failure", async stage => {
    const path = await pathFor(), repository = new FileRepository(path), { supplier, connection, identity } = await seed(repository);
    const token = await reserve(repository, identity);
    syncFailure.mainPath = path; syncFailure.stage = stage;
    await expect(repository.commitCatalogObservation({ reservation: token, connections: [{ connectionId: connection.id,
      fields: { expected: { scannedModelIds: ["old"] }, set: { scannedModelIds: ["new"] } } }],
      state: [{ key: "synced", value: { count: 1 } }] })).rejects.toThrow("fixture-fsync-error");
    syncFailure.mainPath = "";
    const reopened = new FileRepository(path), committed = stage === "finalize";
    expect((await reopened.getConnection(connection.id))?.config.scannedModelIds).toEqual(committed ? ["new"] : ["old"]);
    expect((await reopened.getCatalogPipelineState(supplier.id))?.sources.key?.lastAcceptedSeq).toBe(committed ? token.dispatchSeq : 0);
    expect((await reopened.getCatalogPipelineState(supplier.id))?.entries.synced).toEqual(committed ? { count: 1 } : undefined);
    await reopened.flush();
    expect((await new FileRepository(path).getConnection(connection.id))?.config.scannedModelIds).toEqual(committed ? ["new"] : ["old"]);
  });

  it.each([
    [false, "before"], [false, "after"], [true, "before"], [true, "after"],
  ] as const)("keeps live and reopened legacy business transactions consistent (existing namespace %s, rename %s)", async (withNamespace, phase) => {
    const path = await pathFor(); let armed = false;
    const repository = new FileRepository(path, async (from, to) => {
      const match = armed && String(to) === path;
      if (match && phase === "before") throw crash();
      await rename(from, to); if (match && phase === "after") throw crash();
    });
    const { supplier, connection, identity } = await seed(repository);
    if (withNamespace) await reserve(repository, identity);
    const markerBefore = (await disk(path)).applicationSettings[CATALOG_STORAGE_SETTING];
    armed = true;
    await expect(repository.commitCatalogSnapshot({ expectedSupplier: supplier, expectedConnections: [connection],
      supplier: { ...supplier, name: "Committed supplier" }, connections: [{ ...connection, name: "Committed connection" }] })).rejects.toThrow("fixture-crash");
    const reopened = new FileRepository(path), committed = phase === "after";
    expect((await repository.getSupplier(supplier.id))?.name).toBe(committed ? "Committed supplier" : supplier.name);
    expect((await repository.getConnection(connection.id))?.name).toBe(committed ? "Committed connection" : connection.name);
    expect(await reopened.getSupplier(supplier.id)).toEqual(await repository.getSupplier(supplier.id));
    expect(await reopened.getConnection(connection.id)).toEqual(await repository.getConnection(connection.id));
    // Identical old markers alone must never count as evidence of main commit.
    expect((await disk(path)).applicationSettings[CATALOG_STORAGE_SETTING]).toEqual(markerBefore);
  });
});
