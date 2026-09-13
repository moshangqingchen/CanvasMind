import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";
import { FileRepository } from "../src/file.js";
import type { SupplierRecord } from "../src/types.js";

const supplier: Omit<SupplierRecord, "createdAt" | "updatedAt"> = {
  id: "empty-supplier",
  name: "未配置供应商",
  supplierKey: "custom-empty",
  siteUrl: "https://example.com",
  apiUrl: "",
  kind: "auto",
  catalog: { groups: [] },
  scanStatus: "unscanned",
};
describe("supplier repository", () => {
  it("loads pre-supplier snapshots and preserves connection IDs and secrets", async () => {
    const old = new MemoryRepository();
    await old.saveConnection({
      id: "legacy",
      name: "旧分组",
      provider: "openai",
      encryptedSecret: "encrypted-test-only",
      config: { modelGroup: "旧分组" },
    });
    const snapshot = old.exportSnapshot();
    delete snapshot.suppliers;
    const restored = new MemoryRepository(snapshot);
    expect(await restored.listSuppliers()).toEqual([]);
    await restored.saveSupplier(supplier);
    expect((await restored.getConnection("legacy"))?.encryptedSecret).toBe(
      "encrypted-test-only",
    );
    const clone = await restored.getSupplier(supplier.id);
    clone!.name = "changed outside";
    expect((await restored.getSupplier(supplier.id))?.name).toBe(supplier.name);
  });
  it("persists a supplier with zero groups and no key across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supplier-db-"));
    try {
      const path = join(directory, "state.json");
      await new FileRepository(path).saveSupplier(supplier);
      expect(
        await new FileRepository(path).getSupplier(supplier.id),
      ).toMatchObject(supplier);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("atomically persists archive and deletion across JSON restarts without resurrecting keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "supplier-lifecycle-"));
  try {
    const path = join(directory, "state.json");
    const db = new FileRepository(path);
    const saved = await db.saveSupplier({
      ...supplier,
      state: {
        version: 1,
        revision: 1,
        visibility: "visible",
        sourceId: "old",
        fingerprint: "old",
        history: [],
      },
    });
    const connection = await db.saveConnection({
      id: "kept-id",
      name: "Original",
      provider: "openai",
      encryptedSecret: "encrypted-sentinel",
      config: { supplierId: saved.id, supplierSourceId: "old", usage: "agent" },
    });
    const archived = await db.commitSupplier({
      expectedRevision: 1,
      expectedConnections: [connection],
      connections: [
        {
          ...connection,
          config: { ...connection.config, supplierArchived: true },
        },
      ],
      supplier: {
        ...saved,
        state: {
          ...saved.state!,
          revision: 2,
          sourceId: "new",
          fingerprint: "new",
          history: [
            {
              id: "old",
              siteUrl: saved.siteUrl,
              apiUrl: saved.apiUrl,
              kind: saved.kind,
              catalog: saved.catalog,
              archivedAt: new Date().toISOString(),
              reason: "address-change",
              connectionIds: [connection.id],
            },
          ],
        },
      },
    });
    const reopened = new FileRepository(path);
    expect(
      (await reopened.getConnection(connection.id))?.config.supplierArchived,
    ).toBe(true);
    const expected = await reopened.listConnections();
    await reopened.commitSupplier({
      expectedRevision: 2,
      expectedConnections: expected,
      connections: [],
      deleteConnectionIds: [connection.id],
      supplier: {
        ...archived,
        state: {
          ...archived.state!,
          revision: 3,
          visibility: "deleted",
          history: [],
        },
      },
    });
    const deleted = new FileRepository(path);
    expect(await deleted.listConnections()).toEqual([]);
    expect((await deleted.getSupplier(saved.id))?.state?.visibility).toBe(
      "deleted",
    );
    expect(JSON.stringify(deleted.exportSnapshot())).not.toContain(
      "encrypted-sentinel",
    );
    await expect(
      deleted.saveConnection(connection, { expected: connection }),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("a stale transaction cannot partially archive connections", async () => {
  const db = new MemoryRepository();
  const saved = await db.saveSupplier({
    ...supplier,
    state: {
      version: 1,
      revision: 1,
      visibility: "visible",
      sourceId: "s",
      fingerprint: "s",
      history: [],
    },
  });
  const first = await db.saveConnection({
    id: "first",
    name: "First",
    provider: "openai",
    config: { supplierId: saved.id, supplierSourceId: "s" },
  });
  await db.saveConnection({ ...first, id: "concurrently-added" });
  await expect(
    db.commitSupplier({
      supplier: {
        ...saved,
        apiUrl: "https://new.example.com",
        state: { ...saved.state!, revision: 2 },
      },
      expectedRevision: 1,
      expectedConnections: [first],
      connections: [
        { ...first, config: { ...first.config, supplierArchived: true } },
      ],
    }),
  ).rejects.toThrow("分组配置");
  expect((await db.getSupplier(saved.id))?.apiUrl).toBe(saved.apiUrl);
  expect(
    (await db.getConnection(first.id))?.config.supplierArchived,
  ).toBeUndefined();
});
