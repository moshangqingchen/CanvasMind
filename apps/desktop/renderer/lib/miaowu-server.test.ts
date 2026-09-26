import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { loadMiaowuCatalog } from "./miaowu-catalog";
import { MIAOWU_PRESET_ID } from "./miaowu-presets";
import { syncMiaowuConnection } from "./miaowu-server";

const REPOSITORY_KEY = "__superCanvasRepository";
const CATALOG_CACHE_KEY = "__superCanvasMiaowuCatalog";

function makeRepository(initial: ProviderConnectionRecord) {
  let current = initial;
  const repository = {
    getConnection: vi.fn(async () => structuredClone(current)),
    listConnections: vi.fn(async () => [structuredClone(current)]),
    saveConnection: vi.fn(
      async (
        input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
      ) => {
        current = {
          ...input,
          createdAt: initial.createdAt,
          updatedAt: "saved",
        };
        return structuredClone(current);
      },
    ),
  };
  (globalThis as Record<string, unknown>)[REPOSITORY_KEY] = repository;
  return repository;
}

function oldScannedConnection(): ProviderConnectionRecord {
  return {
    id: "miaowu-vip",
    name: "喵呜 API · vip",
    provider: "rest",
    encryptedSecret: null,
    config: {
      preset: MIAOWU_PRESET_ID,
      supplierKey: "miaowu",
      modelGroup: "vip",
      defaultModel: "seedance-2.0-mx",
      modelScanStatus: "live",
      scannedModelIds: ["seedance-2.0-mini", "seedance-2.0-mx"],
      connector: {
        models: [{ id: "seedance-2.0-mini" }, { id: "seedance-2.0-mx" }],
      },
    },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "initial",
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[REPOSITORY_KEY];
  delete (globalThis as Record<string, unknown>)[CATALOG_CACHE_KEY];
});

describe("syncMiaowuConnection", () => {
  it("preserves every scanned video model without inventing controls", async () => {
    const repository = makeRepository(oldScannedConnection());
    await loadMiaowuCatalog({
      fetch: vi.fn(async () =>
        Response.json({
          group_ratio: { default: 1, vip: 0.8 },
          data: [
            {
              model_name: "seedance-2.0-mini",
              model_price: 0.1142857142857143,
              quota_type: 1,
              enable_groups: ["default", "vip"],
              supported_endpoint_types: ["openai"],
              video_api: {
                images_max: 9,
                videos_max: 3,
                audios_max: 3,
                seconds_min: 5,
                seconds_max: 15,
                sizes: ["480p", "720p"],
                ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              },
            },
            {
              model_name: "kling-3.0-omni",
              model_price: 0.014285714285714287,
              quota_type: 0,
              enable_groups: ["default", "vip"],
              supported_endpoint_types: ["openai"],
              video_api: {
                images_max: 3,
                seconds_min: 5,
                seconds_max: 15,
                sizes: ["720p"],
                ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              },
            },
          ],
        }),
      ) as unknown as typeof fetch,
    });

    const synced = await syncMiaowuConnection("miaowu-vip");
    const config = synced?.config as Record<string, unknown>;
    const connector = config.connector as {
      models: Array<{
        id: string;
        parameters?: unknown[];
        metadata?: Record<string, unknown>;
      }>;
      modelOverrides?: Record<string, { submit?: { path?: string } }>;
    };
    expect(connector.models.map((model) => model.id)).toEqual([
      "seedance-2.0-mini",
      "seedance-2.0-mx",
    ]);
    expect(config.defaultModel).toBe("seedance-2.0-mx");
    expect(
      connector.models.find((model) => model.id === "seedance-2.0-mx"),
    ).toMatchObject({
      parameters: [],
      metadata: { parameterControlsUnavailable: true },
    });
    expect(connector.modelOverrides?.["seedance-2.0-mx"]?.submit?.path).toBe(
      "/v1/chat/completions",
    );
    expect(config.unknownModels).toEqual(["seedance-2.0-mx"]);
    expect(config.unavailableModels).toEqual(["kling-3.0-omni"]);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
  });
});
