import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { encryptSecret } from "@super-canvas/providers";
import { scanMikotoConnection, scanMikotoKeyModels } from "./mikoto-server";
import {
  MIKOTO_GEMINI_GROUP,
  MIKOTO_IMAGE_GROUP,
  MIKOTO_PRESET_ID,
} from "./mikoto-presets";

const MASTER_KEY = "mikoto-scan-test-master-key";
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
    id: "mikoto-1",
    name: "MikotoPro",
    provider: "weai",
    encryptedSecret: encryptSecret("mikoto-group-key", MASTER_KEY),
    config: {
      preset: MIKOTO_PRESET_ID,
      supplierKey: "mikoto",
      modelGroup: MIKOTO_GEMINI_GROUP,
      defaultModel: "gemini-3.1-flash-image-preview",
    },
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "initial",
    ...overrides,
  };
}

function modelsFetch(ids: string[], onCall?: () => void) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    onCall?.();
    expect(String(url)).toBe("https://api.mikoto.vip/v1/models");
    expect(init?.headers).toEqual({
      Authorization: "Bearer mikoto-group-key",
    });
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

describe("scanMikotoKeyModels", () => {
  it("reads the exact key inventory with Bearer auth and dedupes ids", async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.mikoto.vip/v1/models");
        expect(init?.headers).toEqual({ Authorization: "Bearer group-key" });
        return Response.json({
          data: [
            { id: "gpt-image-2" },
            { id: "gpt-image-2" },
            { id: " seedance-2.0-720p " },
            { id: "" },
            { owned_by: "missing-id" },
          ],
        });
      },
    ) as unknown as typeof fetch;
    await expect(
      scanMikotoKeyModels("group-key", { fetch: fetchImpl }),
    ).resolves.toMatchObject({
      status: "live",
      modelIds: ["gpt-image-2", "seedance-2.0-720p"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors a custom base URL and strips trailing slashes", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://proxy.example.com/v1/models");
      return Response.json({ data: [{ id: "gpt-image-2" }] });
    }) as unknown as typeof fetch;
    await expect(
      scanMikotoKeyModels("key", {
        fetch: fetchImpl,
        baseUrl: "https://proxy.example.com/",
      }),
    ).resolves.toMatchObject({ status: "live", modelIds: ["gpt-image-2"] });
  });

  it("treats a successful empty response as authoritative empty", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [] }),
    ) as unknown as typeof fetch;
    await expect(
      scanMikotoKeyModels("key", { fetch: fetchImpl }),
    ).resolves.toMatchObject({ status: "empty", modelIds: [] });
  });

  it("maps 401/403 to unauthorized without reusing model ids", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () =>
        Response.json({ error: { message: "denied" } }, { status }),
      ) as unknown as typeof fetch;
      const result = await scanMikotoKeyModels("key", { fetch: fetchImpl });
      expect(result.status).toBe("unauthorized");
      expect(result.modelIds).toEqual([]);
      expect(result.error).toContain("MikotoPro");
    }
  });

  it("maps other non-2xx, invalid shapes, and network errors to failed", async () => {
    const httpFetch = vi.fn(async () =>
      Response.json({}, { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(
      scanMikotoKeyModels("key", { fetch: httpFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });

    const invalidFetch = vi.fn(async () =>
      Response.json({ data: { id: "stale" } }),
    ) as unknown as typeof fetch;
    await expect(
      scanMikotoKeyModels("key", { fetch: invalidFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });

    const failedFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(
      scanMikotoKeyModels("key", { fetch: failedFetch }),
    ).resolves.toMatchObject({ status: "failed", modelIds: [] });
  });
});

describe("scanMikotoConnection", () => {
  it("fails for a missing or non-Mikoto connection", async () => {
    makeRepository(null);
    await expect(scanMikotoConnection("missing")).resolves.toMatchObject({
      status: "failed",
      modelIds: [],
      connection: null,
    });
  });

  it("returns unconfigured when no API key is saved", async () => {
    const repository = makeRepository(
      connectionRecord({ encryptedSecret: null }),
    );
    const result = await scanMikotoConnection("mikoto-1");
    expect(result.status).toBe("unconfigured");
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("returns unconfigured when the saved key cannot be decrypted", async () => {
    process.env.MASTER_KEY = "a-different-master-key";
    const repository = makeRepository(connectionRecord());
    const result = await scanMikotoConnection("mikoto-1");
    expect(result.status).toBe("unconfigured");
    expect(result.error).toContain("重新填写");
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("persists availability fields and marks snapshot models missing from the live list", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gemini-3.1-flash-image-preview"]);
    const result = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("live");
    expect(result.modelIds).toEqual(["gemini-3.1-flash-image-preview"]);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    const config = result.connection?.config as Record<string, unknown>;
    expect(config.modelScanStatus).toBe("live");
    expect(typeof config.modelScanCheckedAt).toBe("string");
    expect(config.scannedModelIds).toEqual(["gemini-3.1-flash-image-preview"]);
    expect(config.unavailableModels).toEqual(["gemini-3-pro-image-preview"]);
    expect(config.unknownModels).toEqual([]);
    expect(config.defaultModel).toBe("gemini-3.1-flash-image-preview");
  });

  it("surfaces scan-only ids as unknownModels without touching the snapshot list", async () => {
    const repository = makeRepository(
      connectionRecord({
        provider: "rest",
        config: {
          preset: MIKOTO_PRESET_ID,
          supplierKey: "mikoto",
          modelGroup: MIKOTO_IMAGE_GROUP,
          defaultModel: "gpt-image-2",
        },
      }),
    );
    const fetchImpl = modelsFetch(["gpt-image-2", "gpt-image-2-mini"]);
    const result = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("live");
    const config = result.connection?.config as Record<string, unknown>;
    expect(config.scannedModelIds).toEqual(["gpt-image-2", "gpt-image-2-mini"]);
    expect(config.unavailableModels).toEqual([]);
    expect(config.unknownModels).toEqual(["gpt-image-2-mini"]);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    const saved = repository.saveConnection.mock.calls[0]![0] as {
      config: Record<string, unknown>;
    };
    expect(saved.config.defaultModel).toBe("gpt-image-2");
    expect("connector" in saved.config).toBe(false);
  });

  it("persists an authoritative empty scan", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch([]);
    const pending = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
    });
    expect(pending.status).toBe("empty");
    expect(pending.connection?.config.emptyScanConfirmations).toBe(1);
    expect(pending.connection?.config.defaultModel).toBe(
      "gemini-3.1-flash-image-preview",
    );
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);

    const result = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("empty");
    const config = result.connection?.config as Record<string, unknown>;
    expect(config.modelScanStatus).toBe("empty");
    expect(config.scannedModelIds).toEqual([]);
    expect(config.unavailableModels).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
    ]);
    expect(config.emptyScanConfirmations).toBeUndefined();
    expect(repository.saveConnection).toHaveBeenCalledTimes(2);
  });

  it("does not persist unauthorized or failed scans", async () => {
    const repository = makeRepository(connectionRecord());
    const unauthorizedFetch = vi.fn(async () =>
      Response.json({}, { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(
      scanMikotoConnection("mikoto-1", { fetch: unauthorizedFetch }),
    ).resolves.toMatchObject({ status: "unauthorized" });
    const failedFetch = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    await expect(
      scanMikotoConnection("mikoto-1", { fetch: failedFetch }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("skips persistence when persist is false", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gemini-3.1-flash-image-preview"]);
    const result = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
      persist: false,
    });
    expect(result.status).toBe("live");
    expect(repository.saveConnection).not.toHaveBeenCalled();
    expect(result.connection?.config.modelScanStatus).toBeUndefined();
  });

  it("skips the write when a rescan produces an unchanged config", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gemini-3.1-flash-image-preview"]);
    await scanMikotoConnection("mikoto-1", { fetch: fetchImpl });
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    const second = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
    });
    expect(second.status).toBe("live");
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    expect(second.connection?.updatedAt).toBe("saved-1");
  });

  it("retries once when the connection changes concurrently", async () => {
    const repository = makeRepository(connectionRecord());
    let mutated = false;
    const fetchImpl = modelsFetch(["gemini-3.1-flash-image-preview"], () => {
      if (mutated) return;
      mutated = true;
      const current = repository.current();
      if (current)
        repository.setCurrent({ ...current, updatedAt: "concurrent-edit" });
    });
    const result = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
    });
    expect(result.status).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    expect(result.connection?.config.modelScanStatus).toBe("live");
  });

  it("does not retry or write when retryOnConcurrentChange is false", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gemini-3.1-flash-image-preview"], () => {
      const current = repository.current();
      if (current)
        repository.setCurrent({
          ...current,
          updatedAt: `edit-${Math.random()}`,
        });
    });
    const result = await scanMikotoConnection("mikoto-1", {
      fetch: fetchImpl,
      retryOnConcurrentChange: false,
    });
    expect(result.status).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("reuses a recent persisted scan unless explicitly forced", async () => {
    const repository = makeRepository(connectionRecord());
    const fetchImpl = modelsFetch(["gemini-3.1-flash-image-preview"]);
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const first = await scanMikotoConnection("mikoto-1");
      expect(first.status).toBe("live");
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const second = await scanMikotoConnection("mikoto-1");
      expect(second.status).toBe("live");
      expect(second.modelIds).toEqual(["gemini-3.1-flash-image-preview"]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      await scanMikotoConnection("mikoto-1", { force: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
