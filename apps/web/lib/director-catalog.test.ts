import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: {
    listConnections: vi.fn(),
    saveConnection: vi.fn(),
  },
  scanCyberAfeiConnection: vi.fn(),
  scanChentuConnection: vi.fn(),
  scanMiaowuConnection: vi.fn(),
  scanMikotoConnection: vi.fn(),
  scanFriModelConnection: vi.fn(),
}));

vi.mock("./server", () => ({
  repository: mocks.repository,
  runService: {
    adapters: () => ({ get: () => undefined }),
  },
}));

vi.mock("./cangyuan-catalog", () => ({
  loadCangyuanCatalog: vi.fn(),
}));

vi.mock("./cyberafei-server", () => ({
  scanCyberAfeiConnection: mocks.scanCyberAfeiConnection,
}));

vi.mock("./chentu-server", () => ({
  scanChentuConnection: mocks.scanChentuConnection,
}));

vi.mock("./miaowu-server", () => ({
  scanMiaowuConnection: mocks.scanMiaowuConnection,
}));

vi.mock("./mikoto-server", () => ({
  scanMikotoConnection: mocks.scanMikotoConnection,
}));

vi.mock("./frimodel-server", () => ({
  scanFriModelConnection: mocks.scanFriModelConnection,
}));

import { loadDirectorCatalog } from "./director-catalog";

function connection(
  id: string,
  preset: string,
  modelGroup: string,
): ProviderConnectionRecord {
  return {
    id,
    name: id,
    provider: "rest",
    encryptedSecret: "encrypted-secret",
    config: {
      usage: "canvas",
      preset,
      modelGroup,
      supplierKey: id,
    },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const emptyLiveScan = {
    status: "live",
    checkedAt: "2026-08-30T01:00:00.000Z",
    modelIds: [],
  };
  mocks.scanCyberAfeiConnection.mockResolvedValue({
    ...emptyLiveScan,
    catalogSource: "live",
    canvasModels: [],
  });
  mocks.scanChentuConnection.mockResolvedValue({
    ...emptyLiveScan,
    catalogSource: "live",
    canvasModels: [],
  });
  mocks.scanMiaowuConnection.mockResolvedValue(emptyLiveScan);
  mocks.scanMikotoConnection.mockResolvedValue(emptyLiveScan);
  mocks.scanFriModelConnection.mockResolvedValue(emptyLiveScan);
});

describe("loadDirectorCatalog", () => {
  it("scans every persisted supplier catalog without allowing scan persistence", async () => {
    const connections = [
      connection("cyberafei", "cyberafei-api", "images"),
      connection("chentu", "chentu-openai-images", "images"),
      connection("miaowu", "miaowu-openai-videos", "videos"),
      connection("mikoto", "mikoto-pro", "生图（1k）"),
      connection("frimodel", "frimodel-openai-images", "自定义图片模型"),
    ];
    const originalConnections = structuredClone(connections);
    mocks.repository.listConnections.mockResolvedValue(connections);

    await expect(loadDirectorCatalog()).resolves.toEqual([]);

    expect(mocks.scanCyberAfeiConnection).toHaveBeenCalledWith("cyberafei", {
      persist: false,
    });
    expect(mocks.scanChentuConnection).toHaveBeenCalledWith("chentu", {
      persist: false,
    });
    expect(mocks.scanMiaowuConnection).toHaveBeenCalledWith("miaowu", {
      persist: false,
    });
    expect(mocks.scanMikotoConnection).toHaveBeenCalledWith("mikoto", {
      persist: false,
    });
    expect(mocks.scanFriModelConnection).toHaveBeenCalledWith("frimodel", {
      persist: false,
    });
    expect(mocks.repository.saveConnection).not.toHaveBeenCalled();
    expect(connections).toEqual(originalConnections);
  });
});
