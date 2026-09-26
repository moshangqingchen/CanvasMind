import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    ensureDefaultCanvas: vi.fn(async () => ({ id: "canvas-1" })),
    listConnections: vi.fn(
      async (): Promise<
        Array<{ provider: string; config: Record<string, unknown> }>
      > => [],
    ),
  },
  storage: {
    healthCheck: vi.fn(async () => undefined),
  },
}));

vi.mock("../../../lib/server", () => mocks);

import { GET } from "./route";


beforeEach(() => {
  vi.clearAllMocks();
});


describe("local health bridge", () => {

  it("does not expose health data to an unrelated website", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("returns a secret-free supplier scan summary", async () => {
    mocks.repository.listConnections.mockResolvedValueOnce([
      {
        provider: "weai",
        config: {
          supplierKey: "weai",
          modelScanStatus: "live",
          modelScanCheckedAt: "2026-08-28T01:02:03.000Z",
          apiKey: "must-not-appear",
        },
      },
      {
        provider: "rest",
        config: { supplierKey: "custom", catalogCheckedAt: "2026-08-28T00:00:00.000Z" },
      },
    ]);
    const response = await GET();
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      suppliers: {
        weai: {
          connections: 1,
          statuses: { live: 1 },
          lastCheckedAt: "2026-08-28T01:02:03.000Z",
        },
        custom: {
          connections: 1,
          statuses: { unscanned: 1 },
          lastCheckedAt: "2026-08-28T00:00:00.000Z",
        },
      },
    });
    expect(JSON.stringify(payload)).not.toContain("must-not-appear");
  });
});
