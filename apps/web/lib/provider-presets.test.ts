import { describe, expect, it, vi } from "vitest";
import {
  GenericRestAdapter,
  type ProviderConnectionResolver,
  type RestConnectorConfig,
} from "@super-canvas/providers";
import {
  CANGYUAN_ALL_MODELS_GROUP,
  CANGYUAN_BACKUP_IMAGE_CONNECTOR,
  CANGYUAN_BACKUP_IMAGE_GROUP,
  CANGYUAN_BANANA_2_MODEL,
  CANGYUAN_BANANA_PRO_4K_MODEL,
  CANGYUAN_CODEX_IMAGE_MODEL,
  CANGYUAN_IMAGE_CONNECTOR,
  CANGYUAN_IMAGE_DEFAULT_MODEL,
  CANGYUAN_IMAGE_GROUP,
  CANGYUAN_IMAGE_MODEL,
  CANGYUAN_IMAGE_PRESET_ID,
  CANGYUAN_IMAGE_1K_MODEL,
  CANGYUAN_IMAGE_2K_MODEL,
  CANGYUAN_IMAGE_4K_MODEL,
  CANGYUAN_NANO_BANANA_2_1K_MODEL,
  CANGYUAN_NANO_BANANA_2_2K_MODEL,
  CANGYUAN_NANO_BANANA_2_4K_MODEL,
  CANGYUAN_NANO_BANANA_PRO_1K_MODEL,
  CANGYUAN_NANO_BANANA_PRO_2K_MODEL,
  CANGYUAN_NANO_BANANA_PRO_4K_MODEL,
  cangyuanDefaultModelForGroup,
  cangyuanImageConnectionConfig,
  cangyuanImageConnectorForGroup,
  isCangyuanImagePreset,
} from "./provider-presets";

function resolverFor(
  connector: RestConnectorConfig,
): ProviderConnectionResolver {
  return {
    resolve: async () => ({
      id: "cangyuan",
      provider: "rest",
      apiKey: "test-key",
      baseUrl: "https://ai.cangyuansuanli.cn",
      settings: { connector },
    }),
  };
}

describe("provider presets", () => {
  it("keeps marketplace groups isolated and chooses their current defaults", () => {
    expect(CANGYUAN_IMAGE_CONNECTOR.models?.map((model) => model.id)).toEqual([
      CANGYUAN_IMAGE_MODEL,
      CANGYUAN_IMAGE_1K_MODEL,
      CANGYUAN_IMAGE_2K_MODEL,
      CANGYUAN_IMAGE_4K_MODEL,
      CANGYUAN_NANO_BANANA_PRO_1K_MODEL,
      CANGYUAN_NANO_BANANA_PRO_2K_MODEL,
      CANGYUAN_NANO_BANANA_PRO_4K_MODEL,
      CANGYUAN_NANO_BANANA_2_1K_MODEL,
      CANGYUAN_NANO_BANANA_2_2K_MODEL,
      CANGYUAN_NANO_BANANA_2_4K_MODEL,
    ]);
    expect(
      CANGYUAN_BACKUP_IMAGE_CONNECTOR.models?.map((model) => model.id),
    ).toEqual([
      CANGYUAN_CODEX_IMAGE_MODEL,
      CANGYUAN_BANANA_2_MODEL,
      CANGYUAN_BANANA_PRO_4K_MODEL,
    ]);
    expect(cangyuanDefaultModelForGroup(CANGYUAN_IMAGE_GROUP)).toBe(
      CANGYUAN_IMAGE_DEFAULT_MODEL,
    );
    expect(cangyuanDefaultModelForGroup(CANGYUAN_ALL_MODELS_GROUP)).toBe(
      CANGYUAN_IMAGE_4K_MODEL,
    );
    expect(cangyuanDefaultModelForGroup(CANGYUAN_BACKUP_IMAGE_GROUP)).toBe(
      CANGYUAN_CODEX_IMAGE_MODEL,
    );
    expect(
      cangyuanImageConnectorForGroup(CANGYUAN_ALL_MODELS_GROUP).models?.map(
        (model) => model.id,
      ),
    ).toEqual([
      CANGYUAN_IMAGE_MODEL,
      CANGYUAN_IMAGE_1K_MODEL,
      CANGYUAN_IMAGE_2K_MODEL,
      CANGYUAN_IMAGE_4K_MODEL,
      CANGYUAN_NANO_BANANA_PRO_1K_MODEL,
      CANGYUAN_NANO_BANANA_PRO_2K_MODEL,
      CANGYUAN_NANO_BANANA_PRO_4K_MODEL,
      CANGYUAN_NANO_BANANA_2_1K_MODEL,
      CANGYUAN_NANO_BANANA_2_2K_MODEL,
      CANGYUAN_NANO_BANANA_2_4K_MODEL,
    ]);
  });

  it("builds a group-scoped connection config", () => {
    const config = cangyuanImageConnectionConfig(CANGYUAN_BACKUP_IMAGE_GROUP);
    expect(config).toMatchObject({
      preset: CANGYUAN_IMAGE_PRESET_ID,
      modelGroup: CANGYUAN_BACKUP_IMAGE_GROUP,
      defaultModel: CANGYUAN_CODEX_IMAGE_MODEL,
    });
    expect(config.connector.models?.map((model) => model.id)).toEqual([
      CANGYUAN_CODEX_IMAGE_MODEL,
      CANGYUAN_BANANA_2_MODEL,
      CANGYUAN_BANANA_PRO_4K_MODEL,
    ]);
    expect(isCangyuanImagePreset("cangyuan-gpt-image-2-4k")).toBe(true);
  });

  it("submits IMAGE group generation asynchronously and polls the result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task-1", status: "queued" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "task-1",
            status: "completed",
            progress: "100%",
            data: [{ url: "https://cdn.example.com/result.png" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const adapter = new GenericRestAdapter(
      resolverFor(CANGYUAN_IMAGE_CONNECTOR),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "cangyuan",
      operation: "image.generate",
      model: CANGYUAN_IMAGE_MODEL,
      prompt: "电影感城市夜景",
      idempotencyKey: "run:node",
      parameters: { size: "3:2", n: 3 },
    });

    expect(task).toMatchObject({
      providerTaskId: "task-1",
      status: "queued",
      pollAfterMs: 5_000,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      async: true,
      n: 3,
      model: CANGYUAN_IMAGE_MODEL,
      prompt: "电影感城市夜景",
      size: "3:2",
    });
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("connection"),
    ).toBe("close");
    const completed = await adapter.poll(task);
    expect(completed).toMatchObject({ status: "succeeded", progress: 1 });
    await expect(adapter.extractOutputs(completed.result)).resolves.toEqual([
      {
        kind: "image",
        url: "https://cdn.example.com/result.png",
        mimeType: "image/png",
      },
    ]);
  });

  it("submits backup group generation synchronously", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ url: "https://cdn.example.com/backup.png" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = new GenericRestAdapter(
      resolverFor(CANGYUAN_BACKUP_IMAGE_CONNECTOR),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "cangyuan",
      operation: "image.generate",
      model: CANGYUAN_CODEX_IMAGE_MODEL,
      prompt: "产品摄影",
      idempotencyKey: "run:backup",
      parameters: { size: "1:1", quality: "low", n: 2 },
    });

    expect(task.status).toBe("succeeded");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      n: 2,
      model: CANGYUAN_CODEX_IMAGE_MODEL,
      prompt: "产品摄影",
      size: "1:1",
      quality: "low",
    });
  });
});
