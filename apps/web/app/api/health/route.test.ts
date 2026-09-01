import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET, OPTIONS } from "./route";

const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://815rongai.com";
  vi.clearAllMocks();
});

afterEach(() => {
  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
});

describe("local health bridge", () => {
  it("allows only the configured public site to probe the local service", async () => {
    const response = await OPTIONS(
      new Request("http://127.0.0.1:3210/api/health", {
        method: "OPTIONS",
        headers: {
          origin: "https://815rongai.com",
          "access-control-request-private-network": "true",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://815rongai.com",
    );
    expect(response.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
  });

  it("does not expose health data to an unrelated website", async () => {
    const response = await GET(
      new Request("http://127.0.0.1:3210/api/health", {
        headers: { origin: "https://untrusted.example" },
      }),
    );

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
    const response = await GET(
      new Request("http://127.0.0.1:3210/api/health"),
    );
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      runtime: {
        publicAssetUrlConfigured: true,
      },
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
