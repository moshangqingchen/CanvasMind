import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, SupplierConflictError } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, login: vi.fn(), read: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; } }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()), loginSupplierSite: mocks.login }));
vi.mock("./supplier-billing-read", () => ({ readSupplierBilling: mocks.read }));
import { createSupplierRecord, patchSupplierRecord, publicSupplierRecord } from "./supplier-service";
import { refreshSupplierBilling } from "./supplier-billing";

beforeEach(() => { mocks.repository = new MemoryRepository(); mocks.login.mockReset().mockResolvedValue({ kind: "newapi", fetch: vi.fn() }); mocks.read.mockReset(); });
async function fixture() {
  const created = await createSupplierRecord({ name: "Billing", siteUrl: "https://site.invalid", kind: "newapi" });
  const supplier = await patchSupplierRecord(created.id, { siteLogin: { username: "user", password: "private-test-password" } });
  await mocks.repository.saveConnection({ id: "owned", name: "Group", provider: "openai", encryptedSecret: "unchanged", config: { supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId } });
  mocks.read.mockResolvedValue({ sourceId: supplier.state!.sourceId, status: "live", balance: 10, used: 2, todayUsed: .5, todayStatus: "live", unit: "credits", checkedAt: "2026-09-25T00:00:00Z", lastSuccessAt: "2026-09-25T00:00:00Z", sourceUrl: "https://site.invalid/api/user/self" });
  return supplier;
}
describe("supplier billing persistence", () => {
  it("deduplicates refresh and commits with owned connections intact", async () => {
    const supplier = await fixture(); const before = await mocks.repository.listConnections();
    const a = refreshSupplierBilling(supplier.id), b = refreshSupplierBilling(supplier.id);
    expect(a).toBe(b); await a;
    expect(mocks.login).toHaveBeenCalledTimes(1);
    const saved = (await mocks.repository.getSupplier(supplier.id))!;
    expect(saved.state?.billing).toMatchObject({ balance: 10, used: 2, todayUsed: .5, todayStatus: "live", status: "live" });
    expect(saved.state?.revision).toBe(supplier.state!.revision + 1);
    expect(await mocks.repository.listConnections()).toEqual(before);
    expect(JSON.stringify(publicSupplierRecord(saved))).not.toMatch(/private-test-password|encryptedPassword|unchanged/);
  });
  it("preserves last successful values on failure and sanitizes upstream messages", async () => {
    const supplier = await fixture(); const previous = await refreshSupplierBilling(supplier.id);
    mocks.login.mockRejectedValue(Error("password=private-test-password"));
    const failed = await refreshSupplierBilling(supplier.id);
    expect(failed).toMatchObject({ status: "failed", balance: 10, used: 2, todayUsed: .5, lastSuccessAt: previous.lastSuccessAt });
    expect(JSON.stringify(failed)).not.toContain("private-test-password");
  });
  it.each(["source", "login"])("discards an old response after %s changed", async change => {
    const supplier = await fixture(); const result = await mocks.read();
    mocks.read.mockImplementation(async () => {
      await patchSupplierRecord(supplier.id, change === "source" ? { siteUrl: "https://new.invalid" } : { siteLogin: { username: "new", password: "new-password" } });
      return result;
    });
    await expect(refreshSupplierBilling(supplier.id)).rejects.toBeInstanceOf(SupplierConflictError);
    expect((await mocks.repository.getSupplier(supplier.id))?.state?.billing).toBeUndefined();
  });
  it("preserves a concurrent configuration edit and retries a connection conflict", async () => {
    const supplier = await fixture(); const result = await mocks.read();
    mocks.read.mockImplementation(async () => {
      await patchSupplierRecord(supplier.id, { name: "Updated name" }); return result;
    });
    const original = mocks.repository.commitSupplier.bind(mocks.repository);
    let conflicts = 0;
    vi.spyOn(mocks.repository, "commitSupplier").mockImplementation(async input => {
      if (input.supplier.state?.billing && conflicts++ === 0) throw new SupplierConflictError();
      return original(input);
    });
    await refreshSupplierBilling(supplier.id);
    expect(conflicts).toBe(2);
    expect((await mocks.repository.getSupplier(supplier.id))?.name).toBe("Updated name");
  });
  it("does not invent account totals without saved login", async () => {
    const supplier = await createSupplierRecord({ name: "No login", siteUrl: "https://site.invalid" });
    expect(await refreshSupplierBilling(supplier.id)).toMatchObject({ status: "unconfigured" });
    expect(mocks.login).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
});
