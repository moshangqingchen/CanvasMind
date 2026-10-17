import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  decryptSecret: vi.fn(() => "synthetic-key"), providerFetch: vi.fn() }));
vi.mock("./supplier-site-session", () => ({ currentSupplierSiteLogin: vi.fn(() => ({ fixture: true })), openSupplierSiteSession: vi.fn() }));
import { providerFetch, SupplierLoginError } from "@super-canvas/providers";
import { currentSupplierSiteLogin, openSupplierSiteSession } from "./supplier-site-session";
import { catalogPipelineReaders } from "./catalog-pipeline-readers";
import { catalogSourcePlan } from "./catalog-source-plan";
const supplier = { id: "supplier", siteUrl: "https://supplier.invalid", apiUrl: "https://supplier.invalid/v1", kind: "newapi",
  state: { sourceId: "fixture-source", siteLogin: {} } } as SupplierRecord;
const connection = { id: "key", encryptedSecret: "synthetic-ciphertext", config: { baseUrl: supplier.apiUrl, supplierId: supplier.id,
  supplierSourceId: "fixture-source" }, name: "Fixture Key", provider: "openai", createdAt: "2001-01-01T00:00:00Z", updatedAt: "2001-01-01T00:00:00Z" } as ProviderConnectionRecord;
beforeEach(() => { vi.mocked(openSupplierSiteSession).mockReset(); vi.mocked(currentSupplierSiteLogin).mockReturnValue({ fixture: true } as never); });
describe("catalog production read transports", () => {
  it("does no network or session work on creation and puts authentication under the supplied dispatcher", async () => {
    const readers = await catalogPipelineReaders(connection, supplier);
    const account = catalogSourcePlan(connection, supplier).find(spec => spec.authScope.kind === "site-account")!;
    const scheduled = vi.fn<typeof fetch>(async () => Response.json({ fixture: true }));
    vi.mocked(openSupplierSiteSession).mockImplementation(async (_supplier, transport) => {
      await transport!("https://supplier.invalid/api/user/login", { method: "POST", body: "synthetic credentials" });
      return { kind: "newapi", fetch: transport! };
    });
    expect(openSupplierSiteSession).not.toHaveBeenCalled();
    const authenticated = readers.wrapTransport!(account, scheduled);
    expect(openSupplierSiteSession).not.toHaveBeenCalled();
    await authenticated(account.sourceUrl); expect(openSupplierSiteSession).toHaveBeenCalledWith(supplier, scheduled);
    expect(scheduled).toHaveBeenCalledTimes(2); expect(providerFetch).not.toHaveBeenCalled();
  });
  it("leaves unavailable credentials unread and keeps login error text out of diagnostics", async () => {
    vi.mocked(currentSupplierSiteLogin).mockReturnValue(undefined);
    const readers = await catalogPipelineReaders(connection, supplier);
    const account = catalogSourcePlan(connection, supplier).find(spec => spec.authScope.kind === "site-account")!;
    expect(readers.fetchFor(account)).toBeUndefined();
    vi.mocked(openSupplierSiteSession).mockRejectedValue(new SupplierLoginError("synthetic-secret must not be echoed", 401));
    const transport = readers.wrapTransport!(account, vi.fn());
    await expect(transport(account.sourceUrl)).rejects.toMatchObject({ code: "invalid_credentials", httpStatus: 401 });
    await expect(transport(account.sourceUrl)).rejects.not.toThrow("synthetic-secret");
  });
});
