import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord } from "@super-canvas/db";
import { catalogAutomaticConnectionOrder, createCatalogAutomaticCheck } from "./catalog-automatic-check";
import { catalogReadPipelineEnabled } from "./catalog-source-plan";

afterEach(() => vi.useRealTimers());
const row = (id: string, supplierId?: string) => ({ id, name: id, provider: "openai", encryptedSecret: "fixture-only",
  config: { baseUrl: "https://fixture.invalid/v1", ...(supplierId ? { supplierId } : {}) },
  createdAt: "2001-01-01T00:00:00Z", updatedAt: "2001-01-01T00:00:00Z" } as ProviderConnectionRecord);
const clock = { now: Date.now, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>) };

describe("production catalog checker facade", () => {
  it("defaults to the new pipeline and keeps an explicit rollback switch", () => {
    expect(catalogReadPipelineEnabled({})).toBe(true);
    expect(catalogReadPipelineEnabled({ SUPERCANVAS_CATALOG_LEGACY_CHECKER: "1" })).toBe(false);
    expect(catalogReadPipelineEnabled({ SUPERCANVAS_CATALOG_LEGACY_CHECKER: "0" })).toBe(true);
  });
  it("round-robins owners instead of filling the worker pool with one supplier", () => {
    expect(catalogAutomaticConnectionOrder([row("a1", "a"), row("a2", "a"), row("b1", "b"), row("b2", "b"), row("single")]))
      .toEqual(["a1", "b1", "single", "a2", "b2"]);
  });
  it("status and off-mode startup never call the pipeline; close releases its timer", async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2001, 0, 1));
    const repository = new MemoryRepository(); await repository.saveConnection(row("fixture"));
    await repository.setApplicationSetting("supplierCatalogCheckMode", "off");
    const pipeline = { run: vi.fn(async () => ({ enabled: true, published: 0, pending: 0, superseded: 0 })), close: vi.fn() };
    const service = createCatalogAutomaticCheck({ repository, pipeline, revision: "fixture", clock, canContinue: () => true, supported: () => true });
    await service.status(); expect(pipeline.run).not.toHaveBeenCalled();
    await service.settle(); expect(pipeline.run).not.toHaveBeenCalled();
    service.close(); expect(vi.getTimerCount()).toBe(0); expect(pipeline.close).toHaveBeenCalledOnce();
  });
  it("starts a backend-owned round, coalesces repeats, and stops dispatch after drain", async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2001, 0, 1));
    const repository = new MemoryRepository(); await repository.saveConnection(row("fixture"));
    let allowed = true;
    const pipeline = { run: vi.fn(async () => ({ enabled: true, published: 1, pending: 0, superseded: 0, nextWakeAt: Date.now() + 86_400_000 })), close: vi.fn() };
    const service = createCatalogAutomaticCheck({ repository, pipeline, revision: "fixture", clock, canContinue: () => allowed, supported: () => true });
    await service.settle(); expect(pipeline.run).toHaveBeenCalledOnce();
    allowed = false; await vi.advanceTimersByTimeAsync(86_400_000); expect(pipeline.run).toHaveBeenCalledOnce();
    service.close(); expect(vi.getTimerCount()).toBe(0);
  });
});
