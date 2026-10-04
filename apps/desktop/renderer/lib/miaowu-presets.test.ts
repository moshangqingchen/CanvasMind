import { describe, expect, it, vi } from "vitest";
import {
  GenericRestAdapter,
  type ProviderConnectionResolver,
} from "@super-canvas/providers";
import {
  MIAOWU_BASE_URL,
  MIAOWU_CONNECTOR,
  MIAOWU_DEFAULT_MODEL,
  MIAOWU_MODELS,
  miaowuConnectionConfig,
} from "./miaowu-presets";
import { miaowuCatalogFromPricing, miaowuConnectorForModels } from "./miaowu-catalog";

function resolver(): ProviderConnectionResolver {
  return {
    resolve: vi.fn(async () => ({
      id: "miaowu",
      provider: "rest",
      apiKey: "miaowu-secret",
      baseUrl: MIAOWU_BASE_URL,
    })),
  };
}

describe("Miaowu OpenAI Videos preset", () => {
  it("submits native image JSON and downloads completed protected image content with GET", async () => {
    const models = miaowuCatalogFromPricing({ data: [{ model_name: "GPT-image-2",
      image_api: { modes: ["text-to-image", "image-to-image"], images_max: 5,
        sizes: ["1080p"], ratios: ["16:9"] } }] }).models;
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: "image_one", status: "queued" }))
      .mockResolvedValueOnce(Response.json({ id: "image_one", status: "in_progress" }))
      .mockResolvedValueOnce(Response.json({ id: "image_one", status: "completed" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
    const adapter = new GenericRestAdapter(resolver(), { config: miaowuConnectorForModels(models), fetch });
    const task = await adapter.submit({ connectionId: "miaowu", operation: "image.edit", model: "GPT-image-2",
      prompt: "蓝色海面", idempotencyKey: "miaowu-image-one", parameters: { resolution: "1080p", aspect_ratio: "16:9" },
      assets: [{ id: "ref", kind: "image", url: "https://canvas.example.test/reference.png", mimeType: "image/png" }] });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.miaowuai.store/v1/images");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ model: "GPT-image-2", prompt: "蓝色海面",
      resolution: "1080p", ratio: "16:9", image_urls: ["https://canvas.example.test/reference.png"] });
    await expect(adapter.extractOutputs(task.result)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const running = await adapter.poll(task);
    expect(running.status).toBe("running");
    await expect(adapter.extractOutputs(running.result)).resolves.toEqual([]);
    const completed = await adapter.poll({ ...task, result: running.result });
    expect(fetch.mock.calls[1]?.[0]).toBe("https://api.miaowuai.store/v1/images/image_one");
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(fetch.mock.calls[2]?.[0]).toBe("https://api.miaowuai.store/v1/images/image_one");
    expect(fetch.mock.calls[2]?.[1]?.method).toBe("GET");
    const outputs = await adapter.extractOutputs(completed.result);
    expect(outputs).toEqual([{ kind: "image", data: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" }]);
    expect(fetch.mock.calls[3]?.[0]).toBe("https://api.miaowuai.store/v1/images/image_one/content");
    expect(fetch.mock.calls[3]?.[1]?.method).toBe("GET");
    expect(fetch.mock.calls[3]?.[1]?.redirect).toBe("error");
    expect(new Headers(fetch.mock.calls[3]?.[1]?.headers).get("authorization")).toBe("Bearer miaowu-secret");
    expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(JSON.stringify({ task, completed, outputs })).not.toContain("miaowu-secret");
  });

  it("downloads the documented protected Dream content for completed video tasks", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: "video_one", status: "completed", url: "/v1/dream/tasks/video_one/content" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
    const adapter = new GenericRestAdapter(resolver(), { config: MIAOWU_CONNECTOR, fetch });
    const task = await adapter.submit({ connectionId: "miaowu", operation: "video.generate", model: "seedance-2.0-mini",
      prompt: "海面", idempotencyKey: "miaowu-video-content", parameters: { duration: 5, resolution: "480p", aspect_ratio: "16:9" } });
    await expect(adapter.extractOutputs(task.result)).resolves.toEqual([{ kind: "video", data: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }]);
    expect(fetch.mock.calls[1]?.[0]).toBe("https://api.miaowuai.store/v1/dream/tasks/video_one/content");
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer miaowu-secret");
  });
  it("contains all eleven video marketplace models and a safe preset config", () => {
    expect(MIAOWU_MODELS).toHaveLength(11);
    expect(MIAOWU_MODELS.map((model) => model.id)).toContain(
      MIAOWU_DEFAULT_MODEL,
    );
    expect(miaowuConnectionConfig()).toMatchObject({
      supplierKey: "miaowu",
      baseUrl: "https://api.miaowuai.store",
      defaultModel: "seedance-2.0-mini",
    });
    expect(MIAOWU_CONNECTOR.assetsRequirePublicUrls).toBe(true);
    expect(
      MIAOWU_MODELS.find((model) => model.id === "hailuo-3"),
    ).toMatchObject({
      operations: ["video.generate", "video.image-to-video"],
      outputKinds: ["video"],
      parameters: [],
      metadata: { parameterControlsUnavailable: true },
    });
    expect(MIAOWU_CONNECTOR.modelOverrides?.["hailuo-3"]?.submit?.path).toBe(
      "/v1/chat/completions",
    );
    expect(
      MIAOWU_MODELS.find((model) => model.id === "seedance-2.0-mini")?.limits,
    ).toMatchObject({ maxInputImages: 9 });
    const mini = MIAOWU_MODELS.find(
      (model) => model.id === "seedance-2.0-mini",
    )!;
    expect(
      mini.parameters?.find((item) => item.key === "duration"),
    ).toMatchObject({ min: 5, max: 15 });
    expect(
      mini.parameters
        ?.find((item) => item.key === "resolution")
        ?.options?.map((option) => option.value),
    ).toEqual(["480p", "720p"]);
    expect(mini.metadata).toMatchObject({
      clampNumericParameters: true,
      durationMaxByResolution: { "720p": 12 },
    });
    const generic = MIAOWU_MODELS.find(
      (model) => model.id === "kling-3.0-omni",
    )!;
    expect(
      generic.parameters
        ?.find((item) => item.key === "resolution")
        ?.options?.map((option) => option.value),
    ).toEqual(["720p"]);
    expect(generic.metadata?.clampNumericParameters).toBe(true);
    const wan = MIAOWU_MODELS.find(
      (model) => model.id === "wan3.0-video-480p",
    )!;
    expect(
      wan.parameters?.find((item) => item.key === "duration"),
    ).toMatchObject({ min: 2, max: 30, default: 2 });
    expect(
      wan.parameters
        ?.find((item) => item.key === "aspect_ratio")
        ?.options?.map((option) => option.value),
    ).toEqual(["9:16", "16:9", "4:3", "3:4", "1:1"]);
  });

  it("submits documented JSON URL arrays and polls the completed video", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "task_123", status: "queued", progress: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "task_123",
            status: "completed",
            progress: 100,
            url: "https://cdn.example.test/result.mp4",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const adapter = new GenericRestAdapter(resolver(), {
      config: MIAOWU_CONNECTOR,
      fetch,
    });
    const task = await adapter.submit({
      connectionId: "miaowu",
      operation: "video.image-to-video",
      prompt: "让角色走向镜头",
      idempotencyKey: "miaowu-video-1",
      model: MIAOWU_DEFAULT_MODEL,
      parameters: { duration: 8, aspect_ratio: "16:9", resolution: "720p" },
      assets: [
        {
          id: "image-1",
          kind: "image",
          mimeType: "image/png",
          url: "https://canvas.example.test/api/provider-assets/image-1?token=signed",
        },
        {
          id: "video-1",
          kind: "video",
          mimeType: "video/mp4",
          url: "https://canvas.example.test/api/provider-assets/video-1?token=signed",
        },
        {
          id: "audio-1",
          kind: "audio",
          mimeType: "audio/mpeg",
          url: "https://canvas.example.test/api/provider-assets/audio-1?token=signed",
        },
      ],
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.miaowuai.store/v1/videos",
      expect.objectContaining({ method: "POST" }),
    );
    const firstRequest = fetch.mock.calls[0]?.[1];
    const body = JSON.parse(String(firstRequest?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      model: MIAOWU_DEFAULT_MODEL,
      prompt: "让角色走向镜头",
      seconds: 8,
      ratio: "16:9",
      resolution: "720p",
    });
    expect(body.image_urls).toEqual([
      "https://canvas.example.test/api/provider-assets/image-1?token=signed",
    ]);
    expect(body.video_urls).toEqual([
      "https://canvas.example.test/api/provider-assets/video-1?token=signed",
    ]);
    expect(body.audio_urls).toEqual([
      "https://canvas.example.test/api/provider-assets/audio-1?token=signed",
    ]);
    expect(new Headers(firstRequest?.headers).get("authorization")).toBe(
      "Bearer miaowu-secret",
    );

    const completed = await adapter.poll!(task);
    expect(completed.status).toBe("succeeded");
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.miaowuai.store/v1/videos/task_123",
      expect.objectContaining({ method: "GET" }),
    );
    await expect(adapter.extractOutputs(completed.result)).resolves.toEqual([
      {
        kind: "video",
        url: "https://cdn.example.test/result.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });

  it("routes an unparameterized video model through its documented chat endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            message: {
              content: "https://cdn.example.test/hailuo.mp4",
            },
          },
        ],
      }),
    );
    const adapter = new GenericRestAdapter(resolver(), {
      config: MIAOWU_CONNECTOR,
      fetch,
    });

    const task = await adapter.submit({
      connectionId: "miaowu",
      operation: "video.generate",
      prompt: "生成一段海浪视频",
      idempotencyKey: "miaowu-chat-video-1",
      model: "hailuo-3",
      parameters: {},
      assets: [],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.miaowuai.store/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      messages: [{ role: "user", content: "生成一段海浪视频" }],
      stream: false,
      model: "hailuo-3",
    });
    expect(task.status).toBe("succeeded");
    await expect(adapter.extractOutputs(task.result)).resolves.toEqual([
      {
        kind: "video",
        url: "https://cdn.example.test/hailuo.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });
});
