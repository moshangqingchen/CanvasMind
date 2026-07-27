import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE_ASSET_CONCURRENCY, deleteAssets } from "./client-api";

describe("deleteAssets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("limits large deletions to four concurrent requests", async () => {
    let activeRequests = 0;
    let peakRequests = 0;
    const fetchMock = vi.fn(async () => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeRequests -= 1;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const assetIds = Array.from({ length: 23 }, (_, index) => `asset-${index}`);
    const result = await deleteAssets(assetIds);

    expect(fetchMock).toHaveBeenCalledTimes(assetIds.length);
    expect(peakRequests).toBe(DELETE_ASSET_CONCURRENCY);
    expect(result).toEqual({ deletedIds: assetIds, failedIds: [] });
  });

  it("deduplicates IDs and reports per-item failures", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("missing")) return new Response(null, { status: 404 });
      if (url.endsWith("failed")) return new Response(null, { status: 500 });
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteAssets(["deleted", "missing", "failed", "deleted"]),
    ).resolves.toEqual({
      deletedIds: ["deleted", "missing"],
      failedIds: ["failed"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
