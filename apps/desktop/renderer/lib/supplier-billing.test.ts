import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, SupplierConflictError } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, login: vi.fn(), read: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; } }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()), loginSupplierSite: mocks.login }));
vi.mock("./supplier-billing-read", () => ({ readSupplierBilling: mocks.read }));
import { createSupplierRecord, patchSupplierRecord, publicSupplierRecord } from "./supplier-service";
import { refreshSupplierBilling } from "./supplier-billing";
import { SupplierLoginError } from "@super-canvas/providers";

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
  it("retains successful field units on failure but never fills missing partial fields from older currencies", async () => {
    const supplier = await fixture();
    const initial = await mocks.read();
    mocks.read.mockResolvedValue({ ...initial, unit: "CNY", balanceUnit: "CNY", usedUnit: "USD", todayUnit: "USD" });
    await refreshSupplierBilling(supplier.id);
    mocks.login.mockRejectedValueOnce(Error("private-site-failure"));
    expect(await refreshSupplierBilling(supplier.id)).toMatchObject({ status: "failed", balance: 10, used: 2, balanceUnit: "CNY", usedUnit: "USD", todayUnit: "USD" });
    mocks.read.mockResolvedValue({ ...initial, status: "partial", unit: "quota", balance: 50, used: undefined, todayUsed: undefined });
    const partial = await refreshSupplierBilling(supplier.id);
    expect(partial).toMatchObject({ status: "partial", unit: "quota", balance: 50 });
    expect(partial.used).toBeUndefined();
    expect(partial.todayUsed).toBeUndefined();
    expect(partial.usedUnit).toBeUndefined();
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
  it("reads account billing with the saved token session and keeps safe token failure messages", async () => {
    const previous = await fixture();
    const supplier = await patchSupplierRecord(previous.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-billing-token", userId: "42" } });
    await refreshSupplierBilling(supplier.id);
    expect(mocks.login).toHaveBeenCalledWith({ siteUrl: supplier.siteUrl, kind: "newapi", credentials: { accessToken: "fixture-billing-token", userId: "42" } });
    mocks.login.mockRejectedValue(new SupplierLoginError("Authorization: Bearer fixture-billing-token", 403, "permission_denied"));
    const failed = await refreshSupplierBilling(supplier.id);
    expect(failed).toMatchObject({ status: "failed", balance: 10, used: 2 });
    expect(failed.error).toContain("权限");
    expect(JSON.stringify(failed)).not.toContain("fixture-billing-token");
    expect(JSON.stringify(publicSupplierRecord((await mocks.repository.getSupplier(supplier.id))!))).not.toMatch(/fixture-billing-token|encryptedAccessToken/);
  });
  it.each(["token", "user-id", "mode", "clear"] as const)("discards billing fetched before a concurrent %s credential change", async change => {
    const previous = await fixture();
    const supplier = await patchSupplierRecord(previous.id, { siteLogin: { authMode: "access-token", accessToken: "fixture-billing-token", userId: "42" } });
    const result = await mocks.read();
    mocks.read.mockImplementation(async () => {
      await patchSupplierRecord(supplier.id, { siteLogin: change === "clear" ? null
        : change === "mode" ? { username: "new-account", password: "new-fixture-password" }
        : change === "user-id" ? { authMode: "access-token", userId: "43" }
        : { authMode: "access-token", accessToken: "replacement-fixture-token" } });
      return result;
    });
    await expect(refreshSupplierBilling(supplier.id)).rejects.toBeInstanceOf(SupplierConflictError);
    expect((await mocks.repository.getSupplier(supplier.id))?.state?.billing).toBeUndefined();
  });
});
