import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
  discover: vi.fn(),
  models: vi.fn(),
  login: vi.fn(),
}));
vi.mock("./server", () => ({
  get repository() {
    return mocks.repository;
  },
}));
vi.mock("@super-canvas/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@super-canvas/providers")>()),
  discoverSupplierCatalog: mocks.discover,
  loginSupplierSite: mocks.login,
}));
vi.mock("../app/api/providers/[id]/models/route", () => ({
  GET: mocks.models,
}));
import {
  deleteSupplierRecord,
  deleteManualSupplierGroup,
  supplierImpact,
  restoreSupplierHistory,
  assertCurrentSupplierConnection,
  createSupplierRecord,
  getSupplierRecord,
  legacySupplierId,
  listSupplierRecords,
  mergeSupplierCatalog,
  patchSupplierRecord,
  scanSupplierRecord,
  supplierConfigForConnection,
  SupplierInputSchema,
  publicSupplierRecord,
} from "./supplier-service";

beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.discover.mockReset();
  mocks.models.mockReset();
  mocks.login.mockReset();
});
describe("supplier service", () => {
  it("deletes a manual group and both usages without touching platform groups or other keys", async () => {
    const supplier = await createSupplierRecord({
      name: "Site",
      siteUrl: "https://site.example.com",
      catalog: { groups: [{ id: "mine/a", label: "Manual", models: [] }] },
    });
    mocks.discover.mockResolvedValue({
      groups: [{ id: "platform", label: "Platform", models: [] }],
      kind: "newapi",
      status: "live",
      checkedAt: new Date().toISOString(),
    });
    const scanned = await scanSupplierRecord(supplier.id);
    for (const [id, group, usage] of [
      ["canvas-key", "mine/a", "canvas"],
      ["agent-key", "mine/a", "agent"],
      ["platform-key", "platform", "canvas"],
    ]) {
      await mocks.repository.saveConnection({
        id: id!,
        name: id!,
        provider: "openai",
        encryptedSecret: "encrypted-key",
        config: {
          supplierId: supplier.id,
          supplierSourceId: scanned.state!.sourceId,
          modelGroup: group,
          usage,
          customGroup: true,
        },
      });
    }
    await expect(
      deleteManualSupplierGroup(
        supplier.id,
        "platform",
        scanned.state!.revision,
      ),
    ).rejects.toThrow("只能删除手动");
    await expect(
      deleteManualSupplierGroup(
        supplier.id,
        "mine/a",
        scanned.state!.revision - 1,
      ),
    ).rejects.toThrow();
    const updated = await deleteManualSupplierGroup(
      supplier.id,
      "mine/a",
      scanned.state!.revision,
    );
    expect(updated.catalog.groups.map((group) => group.id)).toEqual([
      "platform",
    ]);
    expect(
      (await mocks.repository.listConnections()).map(
        (connection) => connection.id,
      ),
    ).toEqual(["platform-key"]);
    const refreshed = await scanSupplierRecord(supplier.id);
    expect(refreshed.catalog.groups.map((group) => group.id)).toEqual([
      "platform",
    ]);
  });

  it.each([true, false, undefined])(
    "deletes a local-only group regardless of its old customGroup flag (%s)",
    async (customGroup) => {
      const supplier = await createSupplierRecord({
        name: "Site",
        siteUrl: "https://site.example.com",
      });
      await mocks.repository.saveConnection({
        id: "manual-key",
        name: "Manual",
        provider: "openai",
        encryptedSecret: "key",
        config: {
          supplierId: supplier.id,
          supplierSourceId: supplier.state!.sourceId,
          modelGroup: "legacy-manual",
          customGroup,
        },
      });
      await deleteManualSupplierGroup(
        supplier.id,
        "legacy-manual",
        supplier.state!.revision,
      );
      expect(await mocks.repository.getConnection("manual-key")).toBeNull();
    },
  );
  it("allows deleting groups absent from a successful scan and recognizes locally added names when the platform returns them", async () => {
    const supplier = await createSupplierRecord({
      name: "Site",
      siteUrl: "https://site.example.com",
      catalog: { groups: [{ id: "local", label: "Local", models: [] }] },
    });
    mocks.discover.mockResolvedValueOnce({
      groups: [{ id: "local", label: "Platform label", models: [] }],
      kind: "newapi",
      status: "live",
      checkedAt: new Date().toISOString(),
    });
    const scanned = await scanSupplierRecord(supplier.id);
    expect(scanned.catalog.groups[0]).toMatchObject({
      id: "local",
      source: "catalog",
      status: "available",
    });
    await expect(
      deleteManualSupplierGroup(supplier.id, "local", scanned.state!.revision),
    ).rejects.toThrow("只能删除手动");
    mocks.discover.mockResolvedValueOnce({
      groups: [],
      kind: "newapi",
      status: "empty",
      checkedAt: new Date().toISOString(),
    });
    const empty = await scanSupplierRecord(supplier.id);
    expect(empty.catalog.groups[0]?.status).toBe("missing");
    const deleted = await deleteManualSupplierGroup(
      supplier.id,
      "local",
      empty.state!.revision,
    );
    expect(deleted.catalog.groups).toEqual([]);
  });
  it("encrypts reusable website credentials, hides secrets, and logs in on every refresh", async () => {
    const created = await createSupplierRecord({
      name: "Site",
      siteUrl: "https://site.example.com",
      kind: "sub2api",
    });
    const saved = await patchSupplierRecord(created.id, {
      expectedRevision: created.state!.revision,
      siteLogin: {
        username: "account@example.com",
        password: " secret password ",
      },
    });
    expect(saved.state?.siteLogin?.encryptedPassword).toBeTruthy();
    expect(JSON.stringify(saved)).not.toContain("secret password");
    expect(publicSupplierRecord(saved)).toMatchObject({
      siteLogin: { username: "account@example.com", configured: true },
    });
    expect(JSON.stringify(publicSupplierRecord(saved))).not.toContain(
      "encryptedPassword",
    );
    const sessionFetch = vi.fn();
    mocks.login.mockResolvedValue({ kind: "sub2api", fetch: sessionFetch });
    mocks.discover.mockResolvedValue({
      groups: [{ id: "images", label: "Images", models: [] }],
      kind: "sub2api",
      status: "live",
      checkedAt: new Date().toISOString(),
    });
    const scanned = await scanSupplierRecord(
      saved.id,
      undefined,
      saved.state!.revision,
    );
    await scanSupplierRecord(scanned.id, undefined, scanned.state!.revision);
    expect(mocks.login).toHaveBeenCalledTimes(2);
    expect(mocks.login).toHaveBeenCalledWith({
      siteUrl: "https://site.example.com",
      kind: "sub2api",
      credentials: {
        username: "account@example.com",
        password: " secret password ",
      },
    });
    expect(mocks.discover).toHaveBeenCalledWith(
      {
        siteUrl: "https://site.example.com",
        apiUrl: "https://site.example.com",
        kind: "sub2api",
      },
      sessionFetch,
    );
  });

  it("clears saved login when requested or when the supplier address changes", async () => {
    const created = await createSupplierRecord({
      name: "Site",
      siteUrl: "https://site.example.com",
    });
    let saved = await patchSupplierRecord(created.id, {
      siteLogin: { username: "user", password: "private-password" },
    });
    saved = await patchSupplierRecord(saved.id, { siteLogin: null });
    expect(saved.state?.siteLogin).toBeUndefined();
    saved = await patchSupplierRecord(saved.id, {
      siteLogin: { username: "user", password: "private-password" },
    });
    const changed = await patchSupplierRecord(saved.id, {
      siteUrl: "https://other.example.com",
    });
    expect(changed.state?.siteLogin).toBeUndefined();
    expect(JSON.stringify(changed.state?.history)).not.toContain(
      "encryptedPassword",
    );
    const restored = await restoreSupplierHistory(
      changed.id,
      changed.state!.history[0]!.id,
      changed.state!.revision,
    );
    expect(restored.state?.siteLogin).toBeUndefined();
  });

  it("preserves the existing catalog when saved login cannot be used", async () => {
    const created = await createSupplierRecord({
      name: "Site",
      siteUrl: "https://site.example.com",
    });
    const saved = await patchSupplierRecord(created.id, {
      siteLogin: { username: "user", password: "private-password" },
      catalog: { groups: [{ id: "manual", label: "Manual", models: [] }] },
    });
    mocks.login.mockRejectedValue(new Error("private-password"));
    const scanned = await scanSupplierRecord(saved.id);
    expect(scanned.scanStatus).toBe("failed");
    expect(scanned.catalog.groups).toEqual(saved.catalog.groups);
    expect(scanned.scanError).not.toContain("private-password");
    expect(mocks.discover).not.toHaveBeenCalled();
  });
  it("derives old suppliers without mutating connections or materializing records on GET", async () => {
    const old = await mocks.repository.saveConnection({
      id: "old-id",
      name: "Custom",
      provider: "openai",
      encryptedSecret: "encrypted-test-key",
      config: {
        supplierKey: "custom-site",
        baseUrl: "https://gateway.example.com/v1",
        modelGroup: "图像",
      },
    });
    const suppliers = await listSupplierRecords();
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0]?.id).toBe(legacySupplierId(old));
    expect(await mocks.repository.listSuppliers()).toEqual([]);
    expect(await mocks.repository.getConnection(old.id)).toEqual(old);
    expect(
      legacySupplierId({
        provider: "rest",
        config: {
          preset: "cangyuan-gpt-image-2",
          baseUrl: "https://one.example.com",
        },
      }),
    ).not.toBe(
      legacySupplierId({
        provider: "rest",
        config: {
          preset: "cangyuan-gpt-image-2",
          baseUrl: "https://two.example.com",
        },
      }),
    );
    expect(
      legacySupplierId({
        ...old,
        config: { ...old.config, baseUrl: "https://other.example.com" },
      }),
    ).not.toBe(suppliers[0]?.id);
  });
  it("saves empty suppliers and prevents cross-namespace credential attachment", async () => {
    const supplier = await createSupplierRecord({ name: "New site" });
    expect(supplier.catalog.groups).toEqual([]);
    expect(supplier.supplierKey).toMatch(/^custom-/u);
    await expect(
      supplierConfigForConnection({
        provider: "openai",
        config: { supplierId: supplier.id, supplierKey: "other" },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await supplierConfigForConnection({
        provider: "openai",
        config: { supplierId: supplier.id, supplierKey: supplier.supplierKey },
      }),
    ).toMatchObject({ supplierId: supplier.id });
    await expect(
      patchSupplierRecord(supplier.id, { supplierKey: "other" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each(["rest", "openai"] as const)(
    "keeps legacy %s gateway site prefixes without assigning the built-in website",
    async (provider) => {
      const first = await mocks.repository.saveConnection({
        id: "gateway-a",
        name: "A",
        provider,
        config: { baseUrl: "https://example.com/gateway-a/v1/" },
      });
      const second = await mocks.repository.saveConnection({
        id: "gateway-b",
        name: "B",
        provider,
        config: { baseUrl: "https://example.com/gateway-b/v1beta" },
      });
      const explicit = await mocks.repository.saveConnection({
        id: "explicit-site",
        name: "Explicit",
        provider,
        config: {
          baseUrl: "https://example.com/gateway-c/v1",
          supplierWebsiteUrl: "https://catalog.example.com/site",
        },
      });
      const suppliers = await listSupplierRecords();
      expect(suppliers).toHaveLength(3);
      expect(
        suppliers.find((supplier) => supplier.id === legacySupplierId(first)),
      ).toMatchObject({
        siteUrl: "https://example.com/gateway-a",
        apiUrl: "https://example.com/gateway-a/v1",
      });
      expect(
        suppliers.find((supplier) => supplier.id === legacySupplierId(second)),
      ).toMatchObject({
        siteUrl: "https://example.com/gateway-b",
        apiUrl: "https://example.com/gateway-b/v1beta",
      });
      expect(
        suppliers.find((supplier) => supplier.id === legacySupplierId(explicit))
          ?.siteUrl,
      ).toBe("https://catalog.example.com/site");
    },
  );
  it("does not erase manual groups or reclassify returned public data on PATCH", async () => {
    const supplier = await createSupplierRecord({
      name: "Manual",
      catalog: {
        groups: [
          {
            id: "manual",
            label: "Manual",
            source: "manual",
            models: [
              {
                id: "image-id",
                capability: "image",
                protocol: "openai-images",
              },
            ],
          },
        ],
      },
    });
    const merged = mergeSupplierCatalog(
      supplier.catalog,
      { groups: [{ id: "public", label: "Public", models: [] }] },
      true,
    );
    expect(merged.groups.map((group) => [group.id, group.source])).toEqual([
      ["manual", "manual"],
      ["public", "catalog"],
    ]);
    const patch = mergeSupplierCatalog(merged, merged);
    expect(patch.groups.find((group) => group.id === "public")?.source).toBe(
      "catalog",
    );
  });
  it("keeps the previous catalog on scan failure and never stores the temporary token", async () => {
    const supplier = await createSupplierRecord({
      name: "Manual",
      siteUrl: "https://api.example.com",
      apiUrl: "https://api.example.com/v1",
      catalog: { groups: [{ id: "manual", label: "Manual", models: [] }] },
    });
    mocks.discover.mockResolvedValue({
      groups: [],
      kind: "auto",
      status: "failed",
      checkedAt: "2026-09-08T00:00:00.000Z",
      error: "Unavailable",
    });
    const result = await scanSupplierRecord(
      supplier.id,
      "test-temporary-token",
    );
    expect(result.catalog.groups).toHaveLength(1);
    expect(JSON.stringify(await getSupplierRecord(supplier.id))).not.toContain(
      "test-temporary-token",
    );
    expect(result.scanStatus).toBe("failed");
  });
  it("rejects URLs carrying query-string tokens and validates model fields", () => {
    expect(
      SupplierInputSchema.safeParse({
        name: "site",
        siteUrl: "https://example.com?token=secret",
      }).success,
    ).toBe(false);
    expect(
      SupplierInputSchema.safeParse({
        name: "site",
        catalog: {
          groups: [
            {
              id: "g",
              label: "G",
              models: [{ id: "m", capability: "superpower" }],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("keeps saved key inventories separate from public catalog and preserves connection identity", async () => {
    const old = await mocks.repository.saveConnection({
      id: "legacy-group",
      name: "Legacy",
      provider: "openai",
      encryptedSecret: "encrypted-test",
      config: {
        supplierKey: "private-site",
        modelGroup: "images",
        baseUrl: "https://api.example.com/v1",
      },
    });
    mocks.discover.mockResolvedValue({
      groups: [],
      kind: "auto",
      status: "failed",
      checkedAt: "2026-09-08T00:00:00.000Z",
    });
    mocks.models.mockResolvedValue(
      Response.json(
        [
          {
            id: "image-custom",
            name: "Custom",
            operations: ["image.generate"],
          },
        ],
        { headers: { "X-Model-Scan-Status": "live" } },
      ),
    );
    const scanned = await scanSupplierRecord(legacySupplierId(old));
    expect(scanned.scanStatus).toBe("failed");
    expect(scanned.catalog.groups).toEqual([]);
    expect(mocks.models).toHaveBeenCalledTimes(1);
    expect(await mocks.repository.getConnection(old.id)).toMatchObject({
      id: old.id,
      encryptedSecret: old.encryptedSecret,
      config: { ...old.config, supplierId: scanned.id },
    });
  });
  it("does not merge custom suppliers under different gateway prefixes", () => {
    const connection = {
      provider: "openai",
      config: {
        supplierKey: "gateway",
        baseUrl: "https://example.com/gateway/one/v1/",
      },
    };
    expect(legacySupplierId(connection)).toBe(
      legacySupplierId({
        ...connection,
        config: {
          ...connection.config,
          baseUrl: "https://example.com/gateway/one/v1",
        },
      }),
    );
    expect(legacySupplierId(connection)).not.toBe(
      legacySupplierId({
        ...connection,
        config: {
          ...connection.config,
          baseUrl: "https://example.com/gateway/two/v1",
        },
      }),
    );
    expect(
      legacySupplierId({
        provider: "rest",
        config: { baseUrl: "https://example.com/gateway/one" },
      }),
    ).not.toBe(
      legacySupplierId({
        provider: "rest",
        config: { baseUrl: "https://example.com/gateway/two" },
      }),
    );
    expect(
      legacySupplierId({
        provider: "openai",
        config: { baseUrl: "https://example.com/gateway/one" },
      }),
    ).not.toBe(
      legacySupplierId({
        provider: "openai",
        config: { baseUrl: "https://example.com/gateway/two" },
      }),
    );
  });
  it("retains missing public groups and all manual groups across catalog refreshes", () => {
    const catalog = {
      groups: [
        { id: "old", label: "Old", source: "catalog" as const, models: [] },
        {
          id: "manual",
          label: "Manual",
          source: "manual" as const,
          models: [],
        },
      ],
    };
    const refreshed = mergeSupplierCatalog(catalog, { groups: [] }, true);
    expect(refreshed.groups.find((group) => group.id === "old")?.status).toBe(
      "missing",
    );
    expect(refreshed.groups.find((group) => group.id === "manual")).toEqual(
      catalog.groups[1],
    );
    expect(
      mergeSupplierCatalog(
        refreshed,
        { groups: [{ id: "old", label: "Old", models: [] }] },
        true,
      ).groups.find((group) => group.id === "old")?.status,
    ).toBe("available");
  });
  it("preserves the public catalog on unauthorized and rejects stale scan responses", async () => {
    const supplier = await createSupplierRecord({
      name: "Site",
      siteUrl: "https://example.com",
    });
    await mocks.repository.saveSupplier({
      ...supplier,
      catalog: {
        groups: [{ id: "old", label: "Old", source: "catalog", models: [] }],
      },
    });
    mocks.discover.mockResolvedValueOnce({
      groups: [],
      kind: "auto",
      status: "unauthorized",
      checkedAt: "2026-09-08T00:00:00.000Z",
    });
    expect((await scanSupplierRecord(supplier.id)).catalog.groups[0]?.id).toBe(
      "old",
    );
    let finishFirst!: (value: unknown) => void;
    mocks.discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = scanSupplierRecord(supplier.id);
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    mocks.discover.mockResolvedValueOnce({
      groups: [{ id: "new", label: "New", source: "catalog", models: [] }],
      kind: "newapi",
      status: "live",
      checkedAt: "2026-09-08T00:01:00.000Z",
    });
    await scanSupplierRecord(supplier.id);
    finishFirst({
      groups: [{ id: "stale", label: "Stale", source: "catalog", models: [] }],
      kind: "auto",
      status: "live",
      checkedAt: "2026-09-08T00:00:00.000Z",
    });
    await first;
    expect(
      (await getSupplierRecord(supplier.id))?.catalog.groups.some(
        (group) => group.id === "stale",
      ),
    ).toBe(false);
  });
  it("does not overwrite kind or address edits made while scanning", async () => {
    const supplier = await createSupplierRecord({
      name: "Site",
      siteUrl: "https://example.com",
    });
    let finish!: (value: unknown) => void;
    mocks.discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = scanSupplierRecord(supplier.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await patchSupplierRecord(supplier.id, { kind: "sub2api" });
    finish({
      groups: [],
      kind: "newapi",
      status: "empty",
      checkedAt: "2026-09-08T00:00:00.000Z",
    });
    await pending;
    expect((await getSupplierRecord(supplier.id))?.kind).toBe("sub2api");
  });
});

async function savedSource() {
  const supplier = await createSupplierRecord({
    name: "Isolated source",
    siteUrl: "https://old.example.com/gateway/dashboard",
    apiUrl: "https://old.example.com/gateway/v1",
    catalog: {
      groups: [
        {
          id: "manual",
          label: "Manual",
          models: [
            { id: "manual-m", capability: "image", protocol: "openai-images" },
          ],
        },
      ],
    },
  });
  const connection = await mocks.repository.saveConnection({
    id: "original-id",
    name: "Key group",
    provider: "openai",
    encryptedSecret: "encrypted-old-key",
    config: {
      supplierId: supplier.id,
      supplierSourceId: supplier.state!.sourceId,
      supplierKey: supplier.supplierKey,
      baseUrl: supplier.apiUrl,
      modelGroup: "vip",
      usage: "canvas",
      modelScanStatus: "live",
      scannedModelIds: ["m"],
      modelCatalogModels: [
        { id: "m", name: "Model", operations: ["image.generate"] },
      ],
      manualModels: [
        { id: "manual-m", capability: "image", protocol: "openai-images" },
      ],
    },
  });
  return { supplier, connection };
}
describe("source lifecycle and isolation", () => {
  it("normalizes dashboard and equivalent URLs without archiving or moving keys", async () => {
    const { supplier, connection } = await savedSource();
    expect(supplier.siteUrl).toBe("https://old.example.com/gateway");
    const saved = await patchSupplierRecord(supplier.id, {
      name: "Renamed",
      siteUrl: "https://old.example.com/gateway/pricing/",
      apiUrl: supplier.apiUrl + "/",
      expectedRevision: supplier.state!.revision,
    });
    expect(saved.state!.history).toEqual([]);
    expect(saved.state!.sourceId).toBe(supplier.state!.sourceId);
    expect(
      (await mocks.repository.getConnection(connection.id))?.encryptedSecret,
    ).toBe(connection.encryptedSecret);
  });
  it.each(["live", "empty", "failed", "unauthorized"] as const)(
    "archives old config and never sends its key when the new scan is %s",
    async (status) => {
      const { supplier, connection } = await savedSource();
      const next = await patchSupplierRecord(supplier.id, {
        siteUrl: "https://new.example.com",
        apiUrl: "https://new.example.com/v1",
        expectedRevision: supplier.state!.revision,
      });
      expect(next.catalog.groups).toEqual([]);
      expect(next.state!.history[0]).toMatchObject({
        apiUrl: supplier.apiUrl,
        connectionIds: [connection.id],
      });
      expect(await mocks.repository.getConnection(connection.id)).toMatchObject(
        {
          id: connection.id,
          encryptedSecret: connection.encryptedSecret,
          config: {
            usage: "canvas",
            supplierArchived: true,
            baseUrl: supplier.apiUrl,
          },
        },
      );
      mocks.discover.mockResolvedValue({
        groups:
          status === "live"
            ? [{ id: "vip", label: "New VIP", source: "catalog", models: [] }]
            : [],
        status,
        kind: "newapi",
        checkedAt: new Date().toISOString(),
        error: "test failure",
      });
      const result = await scanSupplierRecord(
        next.id,
        undefined,
        next.state!.revision,
      );
      expect(mocks.models).not.toHaveBeenCalled();
      expect(result.catalog.groups.map((g) => g.id)).toEqual(
        status === "live" ? ["vip"] : [],
      );
      expect(JSON.stringify(result)).not.toContain(connection.encryptedSecret!);
      await expect(
        assertCurrentSupplierConnection(
          (await mocks.repository.getConnection(connection.id))!,
        ),
      ).rejects.toThrow("归档");
    },
  );
  it("restores original connection IDs and keys while archiving the other source", async () => {
    const { supplier, connection } = await savedSource();
    const next = await patchSupplierRecord(supplier.id, {
      apiUrl: "https://new.example.com/v1",
    });
    const fresh = await mocks.repository.saveConnection({
      ...connection,
      id: "new-id",
      encryptedSecret: "encrypted-new-key",
      config: {
        ...connection.config,
        baseUrl: next.apiUrl,
        supplierSourceId: next.state!.sourceId,
      },
    });
    const restored = await restoreSupplierHistory(
      next.id,
      supplier.state!.sourceId,
      next.state!.revision,
    );
    expect(restored.apiUrl).toBe(supplier.apiUrl);
    expect(restored.catalog).toEqual(supplier.catalog);
    expect(await mocks.repository.getConnection(connection.id)).toMatchObject({
      encryptedSecret: "encrypted-old-key",
      config: { supplierArchived: false },
    });
    expect(await mocks.repository.getConnection(fresh.id)).toMatchObject({
      encryptedSecret: "encrypted-new-key",
      config: { supplierArchived: true },
    });
  });
  it("platform changes retain the key but invalidate inventory and late writes", async () => {
    const { supplier, connection } = await savedSource();
    const changed = await patchSupplierRecord(supplier.id, { kind: "sub2api" });
    expect(changed.state!.sourceId).toBe(supplier.state!.sourceId);
    const current = await mocks.repository.getConnection(connection.id);
    expect(current?.encryptedSecret).toBe(connection.encryptedSecret);
    expect(current?.config.modelScanStatus).toBe("unscanned");
    await expect(
      mocks.repository.saveConnection(connection, { expected: connection }),
    ).rejects.toThrow("改变");
  });
  it("hiding does not disable a connection; old versions cannot overwrite visibility", async () => {
    const { supplier, connection } = await savedSource();
    const hidden = await patchSupplierRecord(supplier.id, {
      visibility: "hidden",
      expectedRevision: supplier.state!.revision,
    });
    await expect(
      assertCurrentSupplierConnection(
        (await mocks.repository.getConnection(connection.id))!,
      ),
    ).resolves.toBeUndefined();
    await expect(
      patchSupplierRecord(supplier.id, {
        name: "stale",
        expectedRevision: supplier.state!.revision,
      }),
    ).rejects.toThrow();
    expect(hidden.state?.visibility).toBe("hidden");
    expect(
      (
        await patchSupplierRecord(hidden.id, {
          visibility: "visible",
          expectedRevision: hidden.state!.revision,
        })
      ).state?.visibility,
    ).toBe("visible");
  });
  it("replacement removes missing public models and preserves manual sources", async () => {
    const { supplier } = await savedSource();
    mocks.discover.mockResolvedValueOnce({
      groups: [
        {
          id: "g",
          label: "G",
          source: "catalog",
          models: [
            { id: "gone", capability: "image" },
            { id: "keep", capability: "image" },
          ],
        },
      ],
      status: "live",
      checkedAt: "one",
    });
    await scanSupplierRecord(supplier.id);
    mocks.discover.mockResolvedValueOnce({
      groups: [
        {
          id: "g",
          label: "G",
          source: "catalog",
          models: [{ id: "keep", capability: "image" }],
        },
      ],
      status: "live",
      checkedAt: "two",
    });
    const fresh = await scanSupplierRecord(supplier.id);
    expect(
      fresh.catalog.groups.find((g) => g.id === "g")?.models.map((m) => m.id),
    ).toEqual(["keep"]);
    expect(fresh.catalog.groups.find((g) => g.id === "manual")?.source).toBe(
      "manual",
    );
  });
  it("changing key during public discovery does not scan the replacement key with the old request", async () => {
    const { supplier, connection } = await savedSource();
    let finish!: (value: unknown) => void;
    mocks.discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = scanSupplierRecord(supplier.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const latest = (await mocks.repository.getConnection(connection.id))!;
    await mocks.repository.saveConnection(
      { ...latest, encryptedSecret: "new-key" },
      { expected: latest },
    );
    finish({ groups: [], status: "empty", checkedAt: "two" });
    await request;
    expect(mocks.models).not.toHaveBeenCalled();
    expect(
      (await mocks.repository.getConnection(connection.id))?.encryptedSecret,
    ).toBe("new-key");
  });
  it("blocks deletion for unfinished runs, then scrubs keys while preserving canvas references", async () => {
    const { supplier, connection } = await savedSource();
    const graph = {
      nodes: [
        {
          id: "n",
          data: {
            connectionId: connection.id,
            model: "m",
            __runtimeConnection: {
              id: connection.id,
              encryptedSecret: connection.encryptedSecret,
              config: connection.config,
            },
          },
        },
      ],
      edges: [],
    };
    await mocks.repository.saveCanvas({ id: "canvas", title: "Keep", graph });
    await mocks.repository.createRun({
      id: "run",
      canvasId: "canvas",
      clientRequestId: "confirmed",
      scope: "all",
      status: "running",
      revisionGraph: graph,
    });
    expect(await supplierImpact(supplier.id)).toMatchObject({
      keys: 1,
      canvasReferences: 1,
      unfinishedRuns: 1,
    });
    await expect(
      deleteSupplierRecord(supplier.id, supplier.state!.revision),
    ).rejects.toThrow("未完成运行");
    expect(await mocks.repository.getConnection(connection.id)).not.toBeNull();
    await mocks.repository.updateRun("run", { status: "succeeded" });
    await deleteSupplierRecord(supplier.id, supplier.state!.revision);
    expect(await mocks.repository.getConnection(connection.id)).toBeNull();
    expect(
      (await mocks.repository.getCanvas("canvas"))?.graph.nodes,
    ).toHaveLength(1);
    expect(JSON.stringify(await mocks.repository.getRun("run"))).not.toContain(
      "encrypted-old-key",
    );
    await expect(
      mocks.repository.createRun({
        id: "late",
        canvasId: "canvas",
        clientRequestId: "late",
        scope: "all",
        status: "queued",
        revisionGraph: graph,
      }),
    ).rejects.toThrow("删除");
    expect(
      (await listSupplierRecords()).filter(
        (s) => s.state?.visibility !== "deleted",
      ),
    ).toEqual([]);
  });
});
