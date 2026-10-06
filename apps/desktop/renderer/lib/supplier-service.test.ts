import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, SupplierConflictError } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
  discover: vi.fn(),
  models: vi.fn(),
  login: vi.fn(),
  accountKeys: vi.fn(),
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
  readSupplierAccountKeys: mocks.accountKeys,
}));
vi.mock("./provider-model-inventory", () => ({
  readProviderModelInventory: mocks.models,
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
  SupplierPatchSchema,
  publicSupplierRecord,
} from "./supplier-service";
import { decryptSecret, parseSupplierCatalog, SupplierLoginError } from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";

beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.discover.mockReset();
  mocks.models.mockReset();
  mocks.login.mockReset();
  mocks.accountKeys.mockReset().mockResolvedValue({ keys: [], skipped: 0, complete: true, checkedAt: new Date().toISOString() });
});
describe("supplier service", () => {
  it("presents saved Tk1688 quotes in CNY without rewriting prices or unconvertible money snapshots", async () => {
    const supplier = await createSupplierRecord({ name: "词元", siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1", kind: "newapi" });
    supplier.catalog = { groups: [{ id: "default", label: "默认", models: [{ id: "image@s1c1", capability: "image", priceLabel: "$0.03/次（¥0.206688/次）",
      metadata: { tk1688Catalog: true, tk1688FxRate: 6.8896, tk1688Pricing: { kind: "per-request", currency: "USD", unitAmount: .03, checkedAt: "then", confidence: "snapshot" } } }] }] };
    supplier.state!.billing = { sourceId: supplier.state!.sourceId, status: "live", unit: "USD", balance: 5, used: 1, todayUsed: .1,
      checkedAt: "then", sourceUrl: "https://tk1688.com/api/user/self" };
    const view = publicSupplierRecord(supplier);
    expect(view.catalog.groups[0]?.models[0]?.priceLabel).toBe("¥0.206688/次");
    expect(view.state?.billing).toMatchObject({ unit: "CNY", balance: undefined, used: undefined, todayUsed: undefined });
    expect(supplier.catalog.groups[0]?.models[0]?.priceLabel).toBe("$0.03/次（¥0.206688/次）");
    expect(supplier.state?.billing).toMatchObject({ unit: "USD", balance: 5, used: 1, todayUsed: .1 });
  });
  it.each([undefined, true, false])("does not leave imported Key capability requests after a read-only scan: %s", async verifyCapabilities => {
    const created = await createSupplierRecord({ name: "Read-only import", siteUrl: "https://readonly-import.example.test", kind: "sub2api" });
    const supplier = await patchSupplierRecord(created.id, { siteLogin: { username: "fixture-user", password: "fixture-password" } });
    const cleared = await mocks.repository.saveConnection({ id: "cleared", name: "Cleared Key", provider: "openai", encryptedSecret: null,
      config: { supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, modelGroup: "B1", usage: "canvas",
        supplierVerificationRequestId: "cleared-key-old-request" } });
    const existing = await mocks.repository.saveConnection({ id: "keep", name: "Existing Key", provider: "openai", encryptedSecret: "keep-ciphertext",
      config: { supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, modelGroup: "B2", usage: "canvas",
        supplierVerificationRequestId: "existing-key-accepted-request" } });
    mocks.login.mockResolvedValue({ kind: "sub2api", fetch: vi.fn() });
    mocks.discover.mockResolvedValue({ groups: [], kind: "sub2api", status: "empty", complete: true, checkedAt: "2026-10-01T00:00:00Z" });
    mocks.accountKeys.mockResolvedValue({ keys: [
      { id: "1", group: "B1", apiKey: "fixture-b1-key", name: "Filled" },
      { id: "2", group: "B2", apiKey: "fixture-b2-key", name: "Existing" },
      { id: "3", group: "B3", apiKey: "fixture-b3-key", name: "Created" },
    ], complete: true, skipped: 0, checkedAt: "2026-10-01T00:00:00Z" });
    mocks.models.mockResolvedValue(Response.json([], { headers: { "X-Model-Scan-Status": "empty" } }));
    const scanned = await scanSupplierRecord(supplier.id, undefined, supplier.state!.revision, { verifyCapabilities });
    expect(scanned.state?.keySync).toMatchObject({ imported: 2, preserved: 1 });
    const connections = await mocks.repository.listConnections();
    expect(connections.find(connection => connection.id === existing.id)).toMatchObject({ id: existing.id,
      encryptedSecret: existing.encryptedSecret, config: existing.config });
    for (const group of ["B1", "B3"]) {
      const connection = connections.find(item => item.config.modelGroup === group)!;
      expect(decryptSecret(connection.encryptedSecret!, requireServerMasterKey())).toBe(`fixture-${group.toLowerCase()}-key`);
      if (verifyCapabilities === false) expect(connection.config).not.toHaveProperty("supplierVerificationRequestId");
      else {
        expect(connection.config.supplierVerificationRequestId).toEqual(expect.any(String));
        expect(connection.config.supplierVerificationRequestId).not.toBe(cleared.config.supplierVerificationRequestId);
      }
    }
    expect(mocks.models).toHaveBeenCalledTimes(3);
  });
  it("merges partial additions and names without treating unreturned groups or models as removals", () => {
    const catalog: Parameters<typeof mergeSupplierCatalog>[0] = { groups: [
      { id: "public", label: "Old label", source: "catalog", status: "available", models: [
        { id: "updated", name: "Old name", capability: "image", protocol: "openai-images" },
        { id: "retained", name: "Historical", capability: "image", protocol: "rest" },
      ] },
      { id: "unreturned", label: "Historical group", source: "catalog", models: [] },
      { id: "manual", label: "Manual", source: "manual", models: [] },
    ] };
    const incoming: Parameters<typeof mergeSupplierCatalog>[1] = { groups: [
      { id: "public", label: "Current label", models: [
        { id: "updated", name: "Current name", capability: "image", protocol: "openai-images" },
        { id: "new", capability: "video", protocol: "openai-videos" },
      ] },
      { id: "new-group", label: "New group", models: [] },
    ] };
    const partial = mergeSupplierCatalog(catalog, incoming, true, false);
    expect(partial.groups[0]).toMatchObject({ label: "Current label", status: "available", details: { stale: true } });
    expect(partial.groups[0]?.models.map(model => model.id)).toEqual(["updated", "new", "retained"]);
    expect(partial.groups[0]?.models[0]?.name).toBe("Current name");
    expect(partial.groups[0]?.models[2]?.protocol).toBe("rest");
    expect(partial.groups.find(group => group.id === "unreturned")).toMatchObject({ details: { stale: true } });
    expect(partial.groups.find(group => group.id === "manual")).toEqual(catalog.groups[2]);
    const complete = mergeSupplierCatalog(partial, incoming, true, true);
    expect(complete.groups[0]?.models.map(model => model.id)).toEqual(["updated", "new"]);
    expect(complete.groups.find(group => group.id === "unreturned")?.status).toBe("missing");
    expect(complete.groups.find(group => group.id === "manual")).toEqual(catalog.groups[2]);
  });
  it.each(["partial", "throw", "complete"])("preserves account-only model evidence with a %s account directory", async mode => {
    const created = await createSupplierRecord({ name: "Account groups", siteUrl: "https://account-groups.example.test", kind: "sub2api" });
    const supplier = await patchSupplierRecord(created.id, { siteLogin: { username: "user", password: "mock-password" } });
    const confirmed = "2026-09-20T00:00:00.000Z";
    const models = [{ id: "saved-image", name: "Saved image", capability: "image" as const, protocol: "rest" as const }];
    await mocks.repository.saveSupplier({ ...supplier, scanStatus: "live", scanComplete: true, scannedAt: confirmed,
      catalog: { groups: [{ id: "account-only", label: "Account", source: "catalog", status: "available", models }] } });
    mocks.login.mockResolvedValue({ kind: "sub2api", fetch: vi.fn() });
    mocks.discover.mockResolvedValue({ groups: [{ id: "new-public", label: "Public", models: [] }],
      kind: "sub2api", status: "live", complete: true, checkedAt: "2026-10-01T00:00:00.000Z" });
    if (mode === "throw") mocks.accountKeys.mockRejectedValue(new Error("private-upstream-text"));
    else mocks.accountKeys.mockResolvedValue({ keys: mode === "complete" ? [{ id: "1", group: "account-only", apiKey: "mock-account-key", name: "Account" }] : [],
      complete: mode === "complete", skipped: 0, checkedAt: "2026-10-01T00:00:00.000Z" });
    mocks.models.mockResolvedValue(Response.json([], { headers: { "X-Model-Scan-Status": "live" } }));
    const scanned = await scanSupplierRecord(supplier.id);
    expect(scanned.catalog.groups.find(group => group.id === "account-only")).toMatchObject({ status: "available", models, details: { stale: true } });
    expect(scanned.catalog.groups.find(group => group.id === "new-public")?.label).toBe("Public");
    expect(scanned.scanComplete).toBe(mode === "complete");
    expect(scanned.scanLastSuccessAt).toBe(mode === "complete" ? "2026-10-01T00:00:00.000Z" : confirmed);
    expect(JSON.stringify(publicSupplierRecord(scanned))).not.toContain("private-upstream-text");
  });
  it("persists each supplier's generation mode independently without changing its source", async () => {
    const a = await createSupplierRecord({ name: "Cloud choice", apiUrl: "https://a.example.com/v1" });
    const b = await createSupplierRecord({ name: "Local choice", apiUrl: "https://b.example.com/v1" });
    const cloud = await patchSupplierRecord(a.id, { generationTransport: "cloudflare", expectedRevision: a.state!.revision });
    expect(cloud.state?.generationTransport).toBe("cloudflare");
    expect(cloud.state?.sourceId).toBe(a.state?.sourceId);
    expect(cloud.state?.history).toEqual(a.state?.history);
    expect((await getSupplierRecord(b.id))?.state?.generationTransport ?? "local").toBe("local");
    const local = await patchSupplierRecord(a.id, { generationTransport: "local", expectedRevision: cloud.state!.revision });
    expect(local.state?.generationTransport).toBe("local");
  });
  it("round-trips scanned media declarations and upload limits through supplier validation and storage", async () => {
    const catalog = parseSupplierCatalog({ data: { groups: [{ name: "media", models: [{
      id: "gpt-6-astra", protocol: "responses", input_modalities: ["text", "image", "video", "audio"], output_modalities: ["text"],
      limits: { maxInputImages: 8, maxInputVideos: 2, maxInputAudios: 1, maxInputAssets: 9 },
      reasoning_efforts: ["high", "xhigh"],
    }] }] } });
    const parsed = SupplierInputSchema.parse({ name: "Model docs", apiUrl: "https://models.example.test/v1", catalog: { groups: catalog.groups } });
    expect(parsed.catalog?.groups).toEqual(catalog.groups);
    const created = await createSupplierRecord(parsed);
    mocks.discover.mockResolvedValue({ groups: catalog.groups, kind: "sub2api", status: "live", checkedAt: "2026-09-22T00:00:00Z" });
    await scanSupplierRecord(created.id);
    const restored = await getSupplierRecord(created.id);
    expect(restored?.catalog.groups[0]?.models[0]).toEqual(catalog.groups[0]?.models[0]);
    expect(restored?.catalog.groups[0]?.models[0]).toMatchObject({
      inputKinds: ["text", "image", "video", "audio"],
      limits: { maxInputImages: 8, maxInputVideos: 2, maxInputAudios: 1, maxInputAssets: 9 },
      metadata: { modelFactsSource: "supplier-catalog", agentCapabilities: { imageInput: true, videoInput: true, audioInput: true } },
    });
    expect(await mocks.repository.listConnections()).toEqual([]);
  });

  it("rejects malformed upload limits and arbitrary fields in model evidence", () => {
    const parse = (model: Record<string, unknown>) => SupplierInputSchema.safeParse({ name: "Models",
      catalog: { groups: [{ id: "g", label: "G", models: [{ id: "m", capability: "chat", ...model }] }] } }).success;
    expect(parse({ limits: { maxInputImages: -1 } })).toBe(false);
    expect(parse({ limits: { maxInputVideos: 1.5 } })).toBe(false);
    expect(parse({ metadata: { apiKey: "must-not-store" } })).toBe(false);
    expect(parse({ limits: { maxInputImages: 0 }, metadata: { agentCapabilities: { imageInput: false } } })).toBe(true);
  });

  it.each([
    { code: "rate_limited", status: 429, expected: "failed", retryable: true },
    { code: "verification_required", status: 403, expected: "unauthorized", retryable: false },
    { code: "unsupported_platform", status: 400, expected: "failed", retryable: false },
  ] as const)("preserves confirmed directory time and actionable $code failures", async failure => {
    const created = await createSupplierRecord({ name: "Login", siteUrl: "https://site.example.com", kind: "sub2api" });
    const supplier = await patchSupplierRecord(created.id, { siteLogin: { username: "user", password: "mock-password" } });
    const confirmed = "2026-09-20T00:00:00.000Z";
    await mocks.repository.saveSupplier({ ...supplier, scanStatus: "live", scanComplete: true, scannedAt: confirmed });
    mocks.login.mockRejectedValue(new SupplierLoginError("安全的操作提示", failure.status, failure.code));
    const scanned = await scanSupplierRecord(supplier.id);
    expect(scanned).toMatchObject({ scanStatus: failure.expected, scanErrorCode: failure.code,
      scanRetryable: failure.retryable, scanLastSuccessAt: confirmed });
    expect(scanned.scannedAt).not.toBe(confirmed);
    expect(mocks.discover).not.toHaveBeenCalled();
    mocks.login.mockResolvedValue({ kind: "sub2api", fetch: vi.fn() });
    mocks.discover.mockResolvedValue({ kind: "sub2api", groups: [], status: "empty", checkedAt: "2026-09-22T01:00:00Z" });
    const recovered = await scanSupplierRecord(supplier.id);
    expect(recovered.scanLastSuccessAt).toBe("2026-09-22T01:00:00Z");
    expect(recovered.scanErrorCode).toBeUndefined();
    expect(recovered.scanRetryable).toBeUndefined();
  });
  it("imports account keys by exact group, encrypts them, refreshes models and preserves existing keys", async () => {
    const created = await createSupplierRecord({ name: "怪兽ai", siteUrl: "https://site.example.com", kind: "sub2api" });
    const supplier = await patchSupplierRecord(created.id, { siteLogin: { username: "user", password: "password" } });
    const existing = await mocks.repository.saveConnection({
      id: "keep", provider: "openai", name: "Existing B3", encryptedSecret: "keep-ciphertext",
      config: { supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, supplierKey: supplier.supplierKey, modelGroup: "B3", usage: "canvas" },
    });
    mocks.login.mockResolvedValue({ kind: "sub2api", fetch: vi.fn() });
    mocks.discover.mockResolvedValue({ groups: [{ id: "B1", label: "B1", models: [] }], kind: "sub2api", status: "live", checkedAt: new Date().toISOString() });
    mocks.accountKeys.mockResolvedValue({ keys: [
      { id: "1", group: "B1", name: "first", apiKey: "private-b1" },
      { id: "2", group: "B2", name: "second", apiKey: "private-b2" },
      { id: "3", group: "B3", name: "existing", apiKey: "private-b3" },
    ], complete: true, skipped: 1, checkedAt: new Date().toISOString() });
    mocks.models.mockResolvedValue(Response.json([], { headers: { "X-Model-Scan-Status": "live" } }));
    const synced = await scanSupplierRecord(supplier.id);
    expect(synced.state?.keySync).toMatchObject({ imported: 2, preserved: 1, skipped: 1, status: "live" });
    expect(synced.catalog.groups.map(group => group.id)).toEqual(["B1", "B2", "B3"]);
    const connections = await mocks.repository.listConnections();
    expect(connections.find(c => c.id === existing.id)?.encryptedSecret).toBe("keep-ciphertext");
    for (const group of ["B1", "B2"]) {
      const connection = connections.find(c => c.config.modelGroup === group)!;
      expect(decryptSecret(connection.encryptedSecret!, requireServerMasterKey())).toBe(`private-${group.toLowerCase()}`);
      expect(connection.config).toMatchObject({ supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, supplierName: "怪兽ai" });
      expect(JSON.stringify(connection.config)).not.toContain("private-");
    }
    expect(mocks.models).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(publicSupplierRecord(synced))).not.toMatch(/private-|keep-ciphertext|encryptedPassword/);
    const repeated = await scanSupplierRecord(supplier.id);
    expect(repeated.state?.keySync).toMatchObject({ imported: 0, preserved: 3 });
    expect(await mocks.repository.listConnections()).toHaveLength(3);
  });

  it("discards downloaded keys if the supplier source changed during the read", async () => {
    const created = await createSupplierRecord({ name: "Site", siteUrl: "https://site.example.com", kind: "sub2api" });
    const saved = await patchSupplierRecord(created.id, { siteLogin: { username: "user", password: "password" } });
    mocks.login.mockResolvedValue({ kind: "sub2api", fetch: vi.fn() });
    mocks.discover.mockResolvedValue({ groups: [], status: "empty", checkedAt: new Date().toISOString(), kind: "sub2api" });
    mocks.accountKeys.mockImplementation(async () => {
      await patchSupplierRecord(saved.id, { apiUrl: "https://different.example.com" });
      return { keys: [{ id: "1", group: "B1", apiKey: "old-site-secret", name: "old" }], complete: true, skipped: 0, checkedAt: new Date().toISOString() };
    });
    const result = await scanSupplierRecord(saved.id);
    expect(result.apiUrl).toBe("https://different.example.com");
    expect(result.state?.keySync).toBeUndefined();
    expect(await mocks.repository.listConnections()).toEqual([]);
    expect(mocks.models).not.toHaveBeenCalled();
  });
  it("keeps previously discovered account groups visible during a partial model directory refresh", async () => {
    const supplier = await createSupplierRecord({ name: "Partial directory", siteUrl: "https://site.example.com" });
    mocks.discover.mockResolvedValue({ groups: [
      {id: "image", label: "Image", source: "catalog", models: []},
      {id: "account-only", label: "Account", source: "catalog", models: []},
    ], kind: "sub2api", status: "live", checkedAt: new Date().toISOString() });
    await scanSupplierRecord(supplier.id);
    mocks.discover.mockResolvedValue({ groups: [
      {id: "image", label: "Updated", source: "catalog", models: []},
    ], kind: "sub2api", status: "live", complete: false, error: "账号分组暂不可用", checkedAt: new Date().toISOString() });
    const refreshed = await scanSupplierRecord(supplier.id);
    expect(refreshed.catalog.groups).toMatchObject([
      {id: "image", label: "Updated", source: "catalog", status: "available"},
      {id: "account-only", source: "catalog", status: "available"},
    ]);
    expect(refreshed.scanError).toBe("账号分组暂不可用");
  });

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

  it("encrypts site tokens and retains only same-source token credentials for ID-only edits", async () => {
    const created = await createSupplierRecord({ name: "Token", siteUrl: "https://token.invalid", kind: "newapi" });
    let saved = await patchSupplierRecord(created.id, { siteLogin: { authMode: "access-token", accessToken: "  fixture-site-token  ", userId: "42" } });
    const login = saved.state!.siteLogin!;
    expect(login.authMode).toBe("access-token");
    expect(decryptSecret(login.encryptedAccessToken!, requireServerMasterKey())).toBe("fixture-site-token");
    expect(login).not.toHaveProperty("encryptedPassword");
    expect(publicSupplierRecord(saved).siteLogin).toEqual({ authMode: "access-token", configured: true, userId: "42" });
    expect(JSON.stringify(publicSupplierRecord(saved))).not.toMatch(/fixture-site-token|encryptedAccessToken|encryptedPassword/);
    saved = await patchSupplierRecord(saved.id, { siteLogin: { authMode: "access-token", userId: "43" } });
    expect(saved.state?.siteLogin).toMatchObject({ encryptedAccessToken: login.encryptedAccessToken, userId: "43" });
    saved = await patchSupplierRecord(saved.id, { siteLogin: { authMode: "access-token" } });
    expect(saved.state?.siteLogin?.userId).toBe("43");
    saved = await patchSupplierRecord(saved.id, { siteLogin: { authMode: "access-token", userId: null } });
    expect(saved.state?.siteLogin).not.toHaveProperty("userId");
    saved = await patchSupplierRecord(saved.id, { name: "Renamed" });
    expect(saved.state?.siteLogin?.encryptedAccessToken).toBe(login.encryptedAccessToken);
    await expect(patchSupplierRecord(saved.id, { siteUrl: "https://other-token.invalid", siteLogin: { authMode: "access-token", userId: "44" } })).rejects.toThrow("请填写站点访问令牌");
    expect((await getSupplierRecord(saved.id))?.siteUrl).toBe("https://token.invalid");
  });

  it("replaces authentication branches and rejects mode switches without a new token", async () => {
    const created = await createSupplierRecord({ name: "Modes", siteUrl: "https://modes.invalid" });
    let saved = await patchSupplierRecord(created.id, { siteLogin: { username: "account", password: "fixture-password" } });
    await expect(patchSupplierRecord(saved.id, { siteLogin: { authMode: "access-token" } })).rejects.toThrow("请填写站点访问令牌");
    saved = await patchSupplierRecord(saved.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-site-token" } });
    expect(saved.state?.siteLogin).not.toHaveProperty("encryptedPassword");
    expect(saved.state?.siteLogin).not.toHaveProperty("username");
    saved = await patchSupplierRecord(saved.id, { siteLogin: { authMode: "password", username: "account", password: "new-fixture-password" } });
    expect(saved.state?.siteLogin).not.toHaveProperty("encryptedAccessToken");
    expect(publicSupplierRecord(saved).siteLogin).toEqual({ authMode: "password", configured: true, username: "account" });
  });

  it("does not archive or restore token credentials and rejects stale secret updates", async () => {
    const created = await createSupplierRecord({ name: "History", siteUrl: "https://history-token.invalid" });
    const saved = await patchSupplierRecord(created.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-site-token", userId: "42" } });
    const changed = await patchSupplierRecord(saved.id, { siteUrl: "https://new-history-token.invalid" });
    expect(changed.state?.siteLogin).toBeUndefined();
    expect(JSON.stringify(changed.state?.history)).not.toMatch(/fixture-site-token|encryptedAccessToken|encryptedPassword|userId/);
    const restored = await restoreSupplierHistory(changed.id, changed.state!.history[0]!.id, changed.state!.revision);
    expect(restored.state?.siteLogin).toBeUndefined();
    await expect(patchSupplierRecord(saved.id, { expectedRevision: saved.state!.revision, siteLogin: { authMode: "access-token", accessToken: "stale-fixture-token" } })).rejects.toBeInstanceOf(SupplierConflictError);
    expect(JSON.stringify(publicSupplierRecord((await getSupplierRecord(saved.id))!))).not.toContain("stale-fixture-token");
    const current = await patchSupplierRecord(saved.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-site-token" } });
    expect((await patchSupplierRecord(current.id, { siteLogin: null })).state?.siteLogin).toBeUndefined();
  });

  it("validates strict authentication branches and a numeric user ID", () => {
    for (const siteLogin of [
      { authMode: "access-token", accessToken: "fixture-token", password: "password" },
      { authMode: "password", username: "account", password: "password", accessToken: "fixture-token" },
      { authMode: "access-token", accessToken: " " },
      { authMode: "access-token", userId: "0" },
      { authMode: "access-token", userId: "42\r\nAuthorization: injected" },
      { authMode: "access-token", accessToken: "fixture\ntoken" },
      { authMode: "access-token", accessToken: "a".repeat(8193) },
      { authMode: "access-token", userId: "9223372036854775808" },
      { authMode: "access-token", userId: "99999999999999999999" },
    ]) expect(SupplierPatchSchema.safeParse({ siteLogin }).success).toBe(false);
    expect(SupplierPatchSchema.parse({ siteLogin: { authMode: "access-token", accessToken: " fixture-token ", userId: null } }).siteLogin).toEqual({ authMode: "access-token", accessToken: "fixture-token", userId: null });
    expect(SupplierPatchSchema.parse({ siteLogin: { authMode: "access-token", accessToken: `Bearer ${"a".repeat(8192)}`, userId: "9223372036854775807" } }).siteLogin).toMatchObject({ accessToken: "a".repeat(8192), userId: "9223372036854775807" });
    expect(SupplierPatchSchema.parse({ siteLogin: { authMode: "access-token", accessToken: " Bearer fixture-token " } }).siteLogin).toMatchObject({ accessToken: "fixture-token" });
  });

  it("uses the saved token session for scans and discards responses after authentication changes", async () => {
    const created = await createSupplierRecord({ name: "Scan token", siteUrl: "https://scan-token.invalid", kind: "newapi" });
    const saved = await patchSupplierRecord(created.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-old-token", userId: "42" }, catalog: { groups: [{ id: "manual", label: "Manual", models: [] }] } });
    const sessionFetch = vi.fn();
    mocks.login.mockResolvedValue({ kind: "newapi", fetch: sessionFetch });
    mocks.discover.mockImplementation(async () => {
      await patchSupplierRecord(saved.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-new-token" } });
      return { groups: [{ id: "stale", label: "Stale", models: [] }], kind: "newapi", status: "live", checkedAt: "now" };
    });
    const scanned = await scanSupplierRecord(saved.id);
    expect(mocks.login).toHaveBeenCalledWith({ siteUrl: saved.siteUrl, kind: "newapi", credentials: { accessToken: "fixture-old-token", userId: "42" } });
    expect(mocks.discover).toHaveBeenCalledWith({ siteUrl: saved.siteUrl, apiUrl: saved.apiUrl, kind: "newapi" }, sessionFetch);
    expect(scanned.catalog.groups.map(group => group.id)).toEqual(["manual"]);
    expect(decryptSecret(scanned.state!.siteLogin!.encryptedAccessToken!, requireServerMasterKey())).toBe("fixture-new-token");
  });

  it.each(["invalid_token", "permission_denied", "user_id_required"] as const)("classifies %s without storing the token in scan errors", async code => {
    const created = await createSupplierRecord({ name: "Token failure", siteUrl: "https://failed-token.invalid" });
    const saved = await patchSupplierRecord(created.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-site-token" } });
    mocks.login.mockRejectedValue(new SupplierLoginError("Bearer fixture-site-token", 403, code));
    const scanned = await scanSupplierRecord(saved.id);
    expect(scanned).toMatchObject({ scanStatus: "unauthorized", scanErrorCode: code, scanRetryable: false });
    expect(scanned.scanError).not.toContain("fixture-site-token");
    expect(JSON.stringify(publicSupplierRecord(scanned))).not.toContain("fixture-site-token");
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
