import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAssets } from "./client-api";

describe("deleteAssets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a large deletion as one deduplicated request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        deletedIds: Array.from({ length: 123 }, (_, index) => `asset-${index}`),
        failedIds: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const assetIds = Array.from(
      { length: 123 },
      (_, index) => `asset-${index}`,
    );
    const result = await deleteAssets([...assetIds, "asset-0"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/assets/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetIds }),
    });
    expect(result).toEqual({ deletedIds: assetIds, failedIds: [] });
  });

  it("splits deletions larger than the API batch limit and aggregates results", async () => {
    const assetIds = Array.from(
      { length: 991 },
      (_, index) => `asset-${index}`,
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { assetIds: string[] };
        return Response.json({ deletedIds: body.assetIds, failedIds: [] });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAssets(assetIds)).resolves.toEqual({
      deletedIds: assetIds,
      failedIds: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).assetIds,
    ).toHaveLength(500);
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).assetIds,
    ).toHaveLength(491);
  });

  it("reports every requested ID as failed when the batch request fails", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAssets(["one", "two", "one"])).resolves.toEqual({
      deletedIds: [],
      failedIds: ["one", "two"],
    });
  });
});
