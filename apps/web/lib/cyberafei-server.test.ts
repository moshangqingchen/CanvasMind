import { describe, expect, it, vi } from "vitest";
import { scanCyberAfeiKeyModels } from "./cyberafei-server";

describe("cyberafei keyed model scan", () => {
  it("uses the exact key inventory, removes invalid rows, and preserves scan order", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toEqual({
          Authorization: "Bearer secret-group-key",
        });
        return Response.json({
          data: [
            { id: "model-b" },
            { id: "model-a" },
            { id: "model-b" },
            { id: "" },
            { owned_by: "missing-id" },
          ],
        });
      },
    ) as unknown as typeof fetch;

    await expect(
      scanCyberAfeiKeyModels("secret-group-key", { fetch: fetchImpl }),
    ).resolves.toMatchObject({
      status: "live",
      modelIds: ["model-b", "model-a"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a successful empty response as authoritative empty", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [] }),
    ) as unknown as typeof fetch;
    await expect(
      scanCyberAfeiKeyModels("key", { fetch: fetchImpl }),
    ).resolves.toMatchObject({ status: "empty", modelIds: [] });
  });

  it("does not reuse model IDs when the key is unauthorized", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: "denied" } }, { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(
      scanCyberAfeiKeyModels("key", { fetch: fetchImpl }),
    ).resolves.toMatchObject({ status: "unauthorized", modelIds: [] });
  });

  it("returns no models for invalid JSON shapes and network failures", async () => {
    const invalidFetch = vi.fn(async () =>
      Response.json({ data: { id: "stale-model" } }),
    ) as unknown as typeof fetch;
    await expect(
      scanCyberAfeiKeyModels("key", { fetch: invalidFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });

    const failedFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(
      scanCyberAfeiKeyModels("key", { fetch: failedFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });
  });
});
