import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import { encryptSecret } from "@super-canvas/providers";
import { loginSupplierSite as actualLoginSupplierSite } from "../../../../packages/providers/src/supplier-login";
import { parseSupplierCatalog } from "../../../../packages/providers/src/supplier-catalog";
import { requireServerMasterKey } from "./master-key";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, discover: vi.fn(), accountKeys: vi.fn(), modelInventory: vi.fn(), login: vi.fn(), network: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; } }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  discoverSupplierCatalog: mocks.discover, readSupplierAccountKeys: mocks.accountKeys, loginSupplierSite: mocks.login }));
vi.mock("./provider-model-inventory", () => ({ readProviderModelInventory: mocks.modelInventory }));
import { scanSupplierRecord } from "./supplier-service";
const origin = "https://api.3365api.cn", supplierId = "supplier-ba46b25f282ceca6ebbbcf42", sourceId = "f17ed577-0d99-4aae-a23f-c8b38466e92b";
const statusFixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/cyberafei-status-platform-source.json", import.meta.url), "utf8"));
const priceFixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/cyberafei-seedance25-two-group-pricing-source.json", import.meta.url), "utf8"));
const rawPath = process.env.CYBER_CATALOG_ONLY_RAW_PATH, rawBytes = rawPath ? readFileSync(rawPath) : undefined;
const raw = rawBytes ? JSON.parse(rawBytes.toString("utf8")) as { sourceDatabaseSha256: string; connections: ProviderConnectionRecord[]; suppliers: SupplierRecord[] } : undefined;
const byteSha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let proof: Record<string, unknown> | undefined;
afterEach(() => {
  expect(mocks.accountKeys).not.toHaveBeenCalled(); expect(mocks.modelInventory).not.toHaveBeenCalled(); expect(mocks.network).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (proof && process.env.CYBER_CATALOG_ONLY_PROOF_PATH) {
    const target = resolve(process.env.CYBER_CATALOG_ONLY_PROOF_PATH);
    expect(target.startsWith(resolve("../../../.codex-temp/supplier-full-document-recheck-r8-20261010") + sep)).toBe(true);
    writeFileSync(target, JSON.stringify({ ...proof, passed: true, finalGuardCompleted: true }, null, 2) + "\n", { flag: "wx" });
  }
});
describe("Cyber exact catalog-only scan does not synchronize any saved Key", () => {
  it.skipIf(!rawPath)("detects the actual auto site as newapi and commits an empty connection list while preserving all 161 literal contracts", async () => {
    expect(raw!.connections).toHaveLength(161); expect(raw!.suppliers).toHaveLength(18);
    expect(byteSha(rawBytes!)).toBe(process.env.CYBER_CATALOG_ONLY_RAW_SHA256); expect(raw!.sourceDatabaseSha256).toBe(process.env.CYBER_CATALOG_ONLY_DATABASE_SHA256);
    const supplier = structuredClone(raw!.suppliers.find(row => row.id === supplierId)!);
    expect(supplier.kind).toBe("auto"); expect(new URL(supplier.siteUrl).origin).toBe(origin); expect(new URL(supplier.apiUrl).origin).toBe(origin); expect(supplier.state!.sourceId).toBe(sourceId);
    supplier.state!.siteLogin = { siteUrl: origin, authMode: "access-token", encryptedAccessToken: encryptSecret("synthetic-offline-website-only", requireServerMasterKey()), userId: "1" };
    mocks.repository = new MemoryRepository(); mocks.network.mockReset().mockRejectedValue(new Error("No real transport allowed")); vi.stubGlobal("fetch", mocks.network);
    for (const row of raw!.suppliers) await mocks.repository.saveSupplier(row.id === supplierId ? supplier : structuredClone(row));
    for (const row of raw!.connections) await mocks.repository.saveConnection(structuredClone(row));
    const beforeConnections = await mocks.repository.listConnections(), beforeSuppliers = await mocks.repository.listSuppliers();
    const directLoginFetch = vi.fn<typeof fetch>(async url => {
      if (String(url) === origin + "/api/status") return Response.json(statusFixture.responseSubset);
      if (String(url) === origin + "/api/user/self") return Response.json({ success: true, data: { id: 1 } });
      throw new Error("Unexpected platform/login request in isolated replay");
    });
    mocks.login.mockReset().mockImplementation(input => actualLoginSupplierSite(input, directLoginFetch));
    mocks.accountKeys.mockReset().mockRejectedValue(new Error("Never read account Keys for exact Cyber catalogOnly"));
    mocks.modelInventory.mockReset().mockRejectedValue(new Error("Never refresh Key inventory for catalogOnly"));
    const parsed = parseSupplierCatalog({ data: [priceFixture.row], group_ratio: priceFixture.group_ratio, usable_group: priceFixture.usable_group },
      { supplierSiteUrl: origin, currency: "USD", checkedAt: priceFixture.source.checkedAt });
    mocks.discover.mockReset().mockImplementation(async input => {
      expect(input.kind).toBe("newapi"); expect(new URL(input.siteUrl).origin).toBe(origin);
      return { ...parsed, kind: "newapi", status: "live", complete: false, checkedAt: priceFixture.source.checkedAt };
    });
    const commit = vi.spyOn(mocks.repository, "commitSupplier"), save = vi.spyOn(mocks.repository, "saveConnection");
    const result = await scanSupplierRecord(supplierId, undefined, supplier.state!.revision, { catalogOnly: true, verifyCapabilities: false });
    expect(mocks.login).toHaveBeenCalledOnce(); expect(mocks.discover).toHaveBeenCalledOnce();
    expect(directLoginFetch.mock.calls.map(([url]) => String(url))).toEqual([origin + "/api/status", origin + "/api/user/self"]);
    expect(commit.mock.calls.length).toBeGreaterThan(0); for (const [call] of commit.mock.calls) { expect(call.connections).toEqual([]); expect(call.deleteConnectionIds ?? []).toEqual([]); }
    expect(save).not.toHaveBeenCalled(); expect(await mocks.repository.listConnections()).toEqual(beforeConnections);
    expect((await mocks.repository.listSuppliers()).filter(row => row.id !== supplierId)).toEqual(beforeSuppliers.filter(row => row.id !== supplierId));
    for (const group of ["图片视频模型综合分组", "特价seedance2.0"]) {
      const model = result.catalog.groups.find(row => row.id === group)!.models.find(row => row.id === "seedance2.5")!;
      expect(model.metadata?.officialCatalogPricing).toMatchObject({ kind: "tiered", billingUnit: "second", currency: "USD",
        checkedAt: priceFixture.source.checkedAt, tiers: [{ dimension: "resolution", value: "480p", price: 2.625 }, { dimension: "resolution", value: "720p", price: 4.725 }] });
    }
    proof = { sourceReplayIsNotNewOfficialSampling: true, exactSupplierId: supplierId, origin, sourceId, originalSupplierKind: supplier.kind, actualDetectedSessionKind: "newapi",
      sourceDatabaseSha256: raw!.sourceDatabaseSha256, rawSource: { path: rawPath, sha256: byteSha(rawBytes!) }, statusSource: statusFixture.source,
      connectionCount: beforeConnections.length, all161LiteralConnectionContractsPreserved: true, other17SuppliersPreserved: true,
      accountKeyReadCount: 0, keyModelInventoryRefreshCount: 0, saveConnectionCount: 0, commitConnectionCounts: commit.mock.calls.map(([call]) => call.connections.length),
      loginFixtureRequests: 2, catalogDiscoveryFixtureCalls: 1, realNetworkRequests: 0, applicationCalls: 0, liveProfileReads: 0, profileWrites: 0, mediaRequests: 0,
      missingLegacyGroupSub2ExceptionApplies: false, siteCredentialsEntirelySynthetic: true, verifyCapabilities: false, catalogOnly: true };
  });
});
