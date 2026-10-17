import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { previewCatalogUpgradeReads } from "./catalog-upgrade-preview";
import { CATALOG_MODE_SETTING } from "./supplier-catalog-policy";

vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  assertSafeProviderEndpoint: vi.fn(async () => undefined) }));
const environment = { USE_MEMORY_STORE: "ephemeral", SUPERCANVAS_CATALOG_READ_PREVIEW: "1" };

describe("internal catalog upgrade collection preview", () => {
  it("is unreachable in an installed/file profile and never resolves credentials or accesses the repository", async () => {
    const repository = new MemoryRepository(), read = vi.spyOn(repository, "getApplicationSetting"), readers = vi.fn();
    expect((await previewCatalogUpgradeReads("fixture", { environment: { SUPERCANVAS_CATALOG_READ_PREVIEW: "1" }, repository, readers })).status).toBe(404);
    expect(read).not.toHaveBeenCalled(); expect(readers).not.toHaveBeenCalled();
  });
  it("mode off dispatches nothing", async () => {
    const repository = new MemoryRepository(), readers = vi.fn();
    await repository.setApplicationSetting(CATALOG_MODE_SETTING, "off");
    const response = await previewCatalogUpgradeReads("fixture", { environment, repository, readers });
    expect(await response.json()).toMatchObject({ mode: "off", observations: [], publication: "disabled" });
    expect(readers).not.toHaveBeenCalled();
  });
  it("collects Key facts despite every supplier source failing, without save/sync/publication", async () => {
    const repository = new MemoryRepository();
    await repository.saveConnection({ id: "fixture", provider: "openai", name: "Synthetic", encryptedSecret: "not-a-real-secret",
      config: { baseUrl: "https://ai.cangyuansuanli.cn/v1" } });
    const save = vi.spyOn(repository, "saveConnection"), commit = vi.spyOn(repository, "commitCatalogObservation");
    const calls: string[] = [];
    const response = await previewCatalogUpgradeReads("fixture", { environment, repository, readers: async () => ({
      apiKey: "fixture-only-key", fetchFor: spec => async input => {
        calls.push(String(input));
        return spec.entryId === "key-models" ? Response.json({ data: [{ id: "full-model-id" }] }) : new Response(null, { status: 503 });
      },
    }) });
    const result = await response.json();
    expect(result).toMatchObject({ keyVisibleModelIds: ["full-model-id"], publication: "disabled", manifest: { complete: true } });
    expect(calls[0]).toBe("https://ai.cangyuansuanli.cn/v1/models");
    expect(result.observations.filter((row: { receipt: { status: string } }) => row.receipt.status === "failed").length).toBeGreaterThanOrEqual(3);
    expect(save).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fixture-only-key");
  });
});
