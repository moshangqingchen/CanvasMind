import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    listConnections: vi.fn(),
    listSuppliers: vi.fn(),
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
  mocks.repository.listSuppliers.mockResolvedValue([]);
});

describe("providers collection route", () => {
  it("returns the current managed supplier name without rewriting connection identity", async () => {
    const connection = {
      id: "monster-connection", name: "旧名称 · B3 · 画布", provider: "openai",
      config: { supplierId: "monster", supplierKey: "custom-monster", supplierName: "旧名称", modelGroup: "B3", baseUrl: "https://example.com" },
    };
    const supplier = { id: "monster", supplierKey: "custom-monster", name: "怪兽ai", state: { revision: 1 } };
    mocks.repository.listConnections.mockResolvedValue([connection]);
    mocks.repository.listSuppliers.mockResolvedValue([supplier]);
    const read = async () => (await (await GET()).json())[0];
    expect(await read()).toMatchObject({ id: connection.id, config: { supplierName: "怪兽ai", supplierKey: "custom-monster", modelGroup: "B3" } });
    mocks.repository.listSuppliers.mockResolvedValue([{ ...supplier, name: "怪兽设计" }]);
    expect(await read()).toMatchObject({ config: { supplierName: "怪兽设计" } });
    expect(connection.config.supplierName).toBe("旧名称");
    expect(mocks.maskConnection).toHaveBeenCalledTimes(2);
  });

  it("returns saved connections without waiting for Mikoto refresh", async () => {
    mocks.repository.listConnections.mockResolvedValue([
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
