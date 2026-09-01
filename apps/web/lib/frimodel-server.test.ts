import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { encryptSecret } from "@super-canvas/providers";
import {
  scanFriModelConnection,
  scanFriModelKeyModels,
  syncAllFriModelConnections,
  syncFriModelConnection,
} from "./frimodel-server";
import {
  FRIMODEL_BASE_URL,
  FRIMODEL_PRESET_ID,
  FRIMODEL_SUPPLIER_KEY,
  FRIMODEL_WEBSITE_URL,
} from "./frimodel-presets";

const MASTER_KEY = "frimodel-scan-test-master-key";
const REPOSITORY_KEY = "__superCanvasRepository";

interface FakeRepository {
  getConnection: ReturnType<typeof vi.fn>;
  saveConnection: ReturnType<typeof vi.fn>;
  listConnections: ReturnType<typeof vi.fn>;
  setCurrent: (record: ProviderConnectionRecord | null) => void;
  current: () => ProviderConnectionRecord | null;
}

function makeRepository(
  initial: ProviderConnectionRecord | null,
): FakeRepository {
  let current = initial;
  let revision = 0;
  const repository: FakeRepository = {
    getConnection: vi.fn(async () => (current ? { ...current } : null)),
    saveConnection: vi.fn(
      async (input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">) => {
        revision += 1;
        current = {
          ...input,
          createdAt: current?.createdAt ?? "2026-08-28T00:00:00.000Z",
          updatedAt: `saved-${revision}`,
        };
        return { ...current };
      },
    ),
    listConnections: vi.fn(async () => (current ? [{ ...current }] : [])),
    setCurrent: (record) => {
      current = record;
    },
    current: () => (current ? { ...current } : null),
  };
  (globalThis as Record<string, unknown>)[REPOSITORY_KEY] = repository;
  return repository;
}

function connectionRecord(
  overrides?: Partial<ProviderConnectionRecord>,
): ProviderConnectionRecord {
  return {
    id: "frimodel-1",
    name: "FriModel",
    provider: "openai",
    encryptedSecret: encryptSecret("frimodel-key", MASTER_KEY),
    config: {
      preset: FRIMODEL_PRESET_ID,
      supplierKey: FRIMODEL_SUPPLIER_KEY,
      supplierWebsiteUrl: FRIMODEL_WEBSITE_URL,
      usage: "canvas",
      modelGroup: "gpt_image_adobe",
      baseUrl: FRIMODEL_BASE_URL,
      defaultModel: "gpt-image-2-adobe",
      requestTimeoutMs: 300_000,
    },
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "initial",
    ...overrides,
  };
}

function modelsFetch(ids: string[], onCall?: () => void) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    onCall?.();
    expect(String(url)).toBe("https://api.frimodel.com/v1/models");
    expect(init?.headers).toEqual({ Authorization: "Bearer frimodel-key" });
    return Response.json({ data: ids.map((id) => ({ id })) });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.MASTER_KEY = MASTER_KEY;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[REPOSITORY_KEY];
  delete process.env.MASTER_KEY;
});

describe("scanFriModelKeyModels", () => {
  it("hits ${base}/models without doubling the /v1 suffix", async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.frimodel.com/v1/models");
        expect(init?.headers).toEqual({ Authorization: "Bearer group-key" });
        return Response.json({
          data: [
            { id: "gpt-image-2-low" },
            { id: "gpt-image-2-adobe" },
            { id: "gpt-image-2-adobe" },
            { id: "" },
            { owned_by: "missing-id" },
          ],
        });
      },
    ) as unknown as typeof fetch;
    await expect(
      scanFriModelKeyModels("group-key", { fetch: fetchImpl }),
    ).resolves.toMatchObject({
      status: "live",
      modelIds: ["gpt-image-2-low", "gpt-image-2-adobe"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors a custom base URL and strips trailing slashes", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://proxy.example.com/v1/models");
      return Response.json({ data: [{ id: "gpt-image-2" }] });
    }) as unknown as typeof fetch;
    await expect(
      scanFriModelKeyModels("key", {
        fetch: fetchImpl,
        baseUrl: "https://proxy.example.com/v1/",
      }),
    ).resolves.toMatchObject({ status: "live", modelIds: ["gpt-image-2"] });
  });

  it("treats a successful empty response as authoritative empty", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [] }),
    ) as unknown as typeof fetch;
    await expect(
      scanFriModelKeyModels("key", { fetch: fetchImpl }),
    ).resolves.toMatchObject({ status: "empty", modelIds: [] });
  });

  it("maps 401/403 to unauthorized", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () =>
        Response.json({ error: { message: "denied" } }, { status }),
      ) as unknown as typeof fetch;
      const result = await scanFriModelKeyModels("key", { fetch: fetchImpl });
      expect(result.status).toBe("unauthorized");
      expect(result.modelIds).toEqual([]);
      expect(result.error).toContain("FriModel");
    }
  });

  it("maps other non-2xx, invalid shapes, and network errors to failed", async () => {
    const httpFetch = vi.fn(async () =>
      Response.json({}, { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(
      scanFriModelKeyModels("key", { fetch: httpFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });

    const invalidFetch = vi.fn(async () =>
      Response.json({ data: { id: "stale" } }),
    ) as unknown as typeof fetch;
    await expect(
      scanFriModelKeyModels("key", { fetch: invalidFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });

    const failedFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(
      scanFriModelKeyModels("key", { fetch: failedFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });
  });
});

describe("scanFriModelConnection", () => {
  it("fails for a missing or non-FriModel connection", async () => {
    makeRepository(null);
    await expect(scanFriModelConnection("missing")).resolves.toMatchObject({
      status: "failed",
      modelIds: [],
      connection: null,
    });
  });

  it("returns unconfigured when no API key is saved", async () => {
    const repository = makeRepository(
      connectionRecord({ encryptedSecret: null }),
    );
    const result = await scanFriModelConnection("frimodel-1");
    expect(result.status).toBe("unconfigured");
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("returns unconfigured when the saved key cannot be decrypted", async () => {
    process.env.MASTER_KEY = "a-different-master-key";
    const repository = makeRepository(connectionRecord());
    const result = await scanFriModelConnection("frimodel-1");
    expect(result.status).toBe("unconfigured");
    expect(result.error).toContain("重新填写");
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("persists availability, surfacing scan-only ids as unknownModels", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch([
      "gpt-image-2-low",
      "gpt-image-2-adobe",
      "gpt-image-2-medium",
      "gpt-image-2-high",
    ]);
    const result = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("live");
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    const config = result.connection?.config as Record<string, unknown>;
    expect(config.modelScanStatus).toBe("live");
    expect(typeof config.modelScanCheckedAt).toBe("string");
    expect(config.scannedModelIds).toEqual([
      "gpt-image-2-low",
      "gpt-image-2-adobe",
      "gpt-image-2-medium",
      "gpt-image-2-high",
    ]);
    expect(config.unavailableModels).toEqual([]);
    expect(config.unknownModels).toEqual([
      "gpt-image-2-low",
      "gpt-image-2-medium",
    ]);
    expect(config.defaultModel).toBe("gpt-image-2-adobe");
  });

  it("marks snapshot models missing from the live list as unavailable", async () => {
    const repository = makeRepository(
      connectionRecord({
        config: {
          preset: FRIMODEL_PRESET_ID,
          supplierKey: FRIMODEL_SUPPLIER_KEY,
          modelGroup: "gpt_image_wc",
          defaultModel: "gpt-image-2-wc",
        },
      }),
    );
    const fetchImpl = modelsFetch(["gpt-image-2"]);
    const result = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("live");
    const config = result.connection?.config as Record<string, unknown>;
    expect(config.scannedModelIds).toEqual(["gpt-image-2"]);
    expect(config.unavailableModels).toEqual(["gpt-image-2-wc"]);
    expect(config.unknownModels).toEqual([]);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
  });

  it("persists an authoritative empty scan", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch([]);
    const pending = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
    });
    expect(pending.status).toBe("empty");
    expect(pending.connection?.config.emptyScanConfirmations).toBe(1);
    expect(pending.connection?.config.defaultModel).toBe(
      "gpt-image-2-adobe",
    );
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);

    const result = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("empty");
    const config = result.connection?.config as Record<string, unknown>;
    expect(config.modelScanStatus).toBe("empty");
    expect(config.scannedModelIds).toEqual([]);
    expect(config.unavailableModels).toEqual([
      "gpt-image-2-adobe",
      "gpt-image-2-high",
    ]);
    expect(config.emptyScanConfirmations).toBeUndefined();
    expect(repository.saveConnection).toHaveBeenCalledTimes(2);
  });

  it("does not persist unauthorized or failed scans", async () => {
    const repository = makeRepository(connectionRecord());
    const unauthorizedFetch = vi.fn(async () =>
      Response.json({}, { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(
      scanFriModelConnection("frimodel-1", { fetch: unauthorizedFetch }),
    ).resolves.toMatchObject({ status: "unauthorized" });
    const failedFetch = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    await expect(
      scanFriModelConnection("frimodel-1", { fetch: failedFetch }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("skips persistence when persist is false", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gpt-image-2-adobe"]);
    const result = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
      persist: false,
    });
    expect(result.status).toBe("live");
    expect(repository.saveConnection).not.toHaveBeenCalled();
    expect(result.connection?.config.modelScanStatus).toBeUndefined();
  });

  it("skips the write when a rescan produces an unchanged config", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gpt-image-2-adobe", "gpt-image-2-high"]);
    await scanFriModelConnection("frimodel-1", { fetch: fetchImpl });
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    const second = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
    });
    expect(second.status).toBe("live");
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    expect(second.connection?.updatedAt).toBe("saved-1");
  });

  it("retries once when the connection changes concurrently", async () => {
    const repository = makeRepository(connectionRecord());
    let mutated = false;
    const fetchImpl = modelsFetch(["gpt-image-2-adobe"], () => {
      if (mutated) return;
      mutated = true;
      const current = repository.current();
      if (current)
        repository.setCurrent({ ...current, updatedAt: "concurrent-edit" });
    });
    const result = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    expect(result.connection?.config.modelScanStatus).toBe("live");
  });

  it("does not retry or write when retryOnConcurrentChange is false", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gpt-image-2-adobe"], () => {
      const current = repository.current();
      if (current)
        repository.setCurrent({
          ...current,
          updatedAt: `edit-${Math.random()}`,
        });
    });
    const result = await scanFriModelConnection("frimodel-1", {
      fetch: fetchImpl,
      retryOnConcurrentChange: false,
    });
    expect(result.status).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });
});

describe("syncFriModelConnection", () => {
  it("fills missing preset fields while keeping the saved default model", async () => {
    const repository = makeRepository(
      connectionRecord({
        config: {
          preset: FRIMODEL_PRESET_ID,
          modelGroup: "gpt_image_adobe",
          defaultModel: "gpt-image-2-high",
        },
      }),
    );
    const synced = await syncFriModelConnection("frimodel-1");
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    expect(synced?.config).toMatchObject({
      preset: FRIMODEL_PRESET_ID,
      supplierKey: FRIMODEL_SUPPLIER_KEY,
      supplierWebsiteUrl: FRIMODEL_WEBSITE_URL,
      usage: "canvas",
      modelGroup: "gpt_image_adobe",
      baseUrl: FRIMODEL_BASE_URL,
      defaultModel: "gpt-image-2-high",
    });
  });

  it("skips the write when the config is already up to date", async () => {
    const repository = makeRepository(connectionRecord());
    const synced = await syncFriModelConnection("frimodel-1");
    expect(repository.saveConnection).not.toHaveBeenCalled();
    expect(synced?.updatedAt).toBe("initial");
  });

  it("ignores non-FriModel connections", async () => {
    const repository = makeRepository(
      connectionRecord({ config: { preset: "other-preset" } }),
    );
    await syncFriModelConnection("frimodel-1");
    await syncAllFriModelConnections();
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("syncAllFriModelConnections refreshes every FriModel connection", async () => {
    const repository = makeRepository(
      connectionRecord({
        config: { preset: FRIMODEL_PRESET_ID, modelGroup: "codex_image" },
      }),
    );
    const synced = await syncAllFriModelConnections();
    expect(synced).toHaveLength(1);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    expect(synced[0]?.config).toMatchObject({
      modelGroup: "codex_image",
      defaultModel: "gpt-image-2",
    });
  });
});
