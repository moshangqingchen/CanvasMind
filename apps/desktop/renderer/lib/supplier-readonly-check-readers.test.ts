import { describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
vi.mock("./catalog-pipeline-readers", () => ({ catalogPipelineReaders: vi.fn() }));
import { catalogPipelineReaders } from "./catalog-pipeline-readers";
import { createSupplierReadOnlyReaders } from "./supplier-readonly-check-readers";
import { catalogSourcePlan } from "./catalog-source-plan";

const supplier = { id: "account", siteUrl: "https://fixture.invalid", apiUrl: "https://fixture.invalid/v1", kind: "newapi" } as SupplierRecord;
const row = (id: string): ProviderConnectionRecord => ({ id, name: id, provider: "openai", encryptedSecret: id,
  config: { supplierId: supplier.id, baseUrl: supplier.apiUrl }, createdAt: "before", updatedAt: "before" });

describe("request-local read-only source deduplication", () => {
  it("shares public reads across Keys, keeps each Key separate, and discards sharing after the request", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ fixture: true }));
    vi.mocked(catalogPipelineReaders).mockImplementation(async () => ({ apiKey: "fixture", fetchFor: () => transport }));
    const factory = createSupplierReadOnlyReaders(), a = row("a"), b = row("b");
    const first = await factory(a, supplier), second = await factory(b, supplier);
    const planA = catalogSourcePlan(a, supplier), planB = catalogSourcePlan(b, supplier);
    const publicA = planA.find(spec => spec.entryId === "supplier:pricing:anonymous")!;
    const publicB = planB.find(spec => spec.entryId === "supplier:pricing:anonymous")!;
    const responses = await Promise.all([first.fetchFor(publicA)!(publicA.sourceUrl), second.fetchFor(publicB)!(publicB.sourceUrl)]);
    expect(await responses[0]!.json()).toEqual({ fixture: true });
    expect(await responses[1]!.json()).toEqual({ fixture: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenLastCalledWith(publicA.sourceUrl, expect.objectContaining({ cache: "no-store" }));
    await first.fetchFor(planA[0]!)!(planA[0]!.sourceUrl);
    await second.fetchFor(planB[0]!)!(planB[0]!.sourceUrl);
    expect(transport).toHaveBeenCalledTimes(3);
    const later = await createSupplierReadOnlyReaders()(a, supplier);
    await later.fetchFor(publicA)!(publicA.sourceUrl);
    expect(transport).toHaveBeenCalledTimes(4);
    await expect(later.fetchFor(publicA)!(publicA.sourceUrl, { method: "POST" })).rejects.toThrow("requires GET");
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("wraps account authentication only when the corresponding source is actually read", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ fixture: true }));
    const authenticated = vi.fn<typeof fetch>(transport), wrapTransport = vi.fn(() => authenticated);
    vi.mocked(catalogPipelineReaders).mockResolvedValue({ apiKey: "fixture", fetchFor: () => transport, wrapTransport });
    const connection = row("a"), readers = await createSupplierReadOnlyReaders()(connection, supplier);
    const account = catalogSourcePlan(connection, supplier).find(spec => spec.authScope.kind === "site-account")!;
    expect(authenticated).not.toHaveBeenCalled();
    await readers.fetchFor(account)!(account.sourceUrl);
    expect(wrapTransport).toHaveBeenCalledWith(account, transport);
    expect(authenticated).toHaveBeenCalledTimes(1);
  });
});
