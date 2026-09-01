import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    listConnections: vi.fn(),
  },
  maskConnection: vi.fn((connection: unknown) => connection),
}));

vi.mock("../../../lib/server", () => ({
  repository: mocks.repository,
  maskConnection: mocks.maskConnection,
}));

import { GET } from "./route";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("providers collection route", () => {
  it("returns saved connections without waiting for Mikoto refresh", async () => {
    mocks.repository.listConnections.mockResolvedValueOnce([
      { id: "connection-1", provider: "fake", config: { name: "Demo" } },
    ]);

    const response = await withTimeout(
      GET(new Request("http://localhost/api/providers?fresh=1")),
      100,
    );
    const payload = (await response.json()) as Array<{ id: string }>;

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      {
        id: "connection-1",
        provider: "fake",
        config: { name: "Demo" },
      },
    ]);
  });
});
