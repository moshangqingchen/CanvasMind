import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "@super-canvas/providers";
import { GenericRestAdapter } from "@super-canvas/providers";
import {
  MIKOTO_CONNECTOR,
  MIKOTO_DEFAULT_MODEL,
  MIKOTO_GROUPS,
  MIKOTO_GEMINI_GROUP,
  MIKOTO_IMAGE_GROUP,
  MIKOTO_KLING_GROUP,
  MIKOTO_GROK_GROUP,
  MIKOTO_GROK_MODEL,
  MIKOTO_MODELS,
  MIKOTO_SEEDANCE_GROUP,
  mikotoConnectionConfig,
  mikotoConnectorForGroup,
  mikotoGroup,
} from "./mikoto-presets";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function adapter(fetch: typeof globalThis.fetch) {
  return new GenericRestAdapter(
    new StaticConnectionResolver([
      {
        id: "mikoto",
        provider: "rest",
        apiKey: "mikoto-secret",
        baseUrl: "https://api.mikoto.vip",
      },
    ]),
    { config: MIKOTO_CONNECTOR, fetch },
  );
}

describe("MikotoPro connector", () => {
  it("declares the documented image, Seedance, and Kling models", () => {
    const config = mikotoConnectionConfig();
    expect(config.supplierKey).toBe("mikoto");
    expect(config.baseUrl).toBe("https://api.mikoto.vip");
    expect(config.defaultModel).toBe(MIKOTO_DEFAULT_MODEL);
    expect(MIKOTO_MODELS.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "seedance-2.0-1080p",
      "seedance-2.0-720p",
      "seedance-fast-480p",
      "seedance-fast-720p",
      "kling-video",
      "kling-omni-video",
      MIKOTO_GROK_MODEL,
      "sora-v3-pro",
    ]);
    expect(MIKOTO_MODELS.map((model) => model.name)).toEqual([
      "GPT Image 2（原生4K组 $0.08/张）",
      "seedance-2.0-1080p（$0.35/秒）",
      "seedance-2.0-720p（$0.25/秒）",
      "seedance-fast-480p（$0.15/秒）",
      "seedance-fast-720p（$0.20/秒）",
      "kling-video（$0.70/次）",
      "kling-omni-video（$1.00/次）",
      "Grok Imagine Image（$0.02/张）",
      "Sora V3 Pro（$0.35/秒）",
    ]);
    expect(
      mikotoGroup(MIKOTO_GEMINI_GROUP)?.models.map((model) => model.name),
    ).toEqual([
      "Gemini 3.1 Flash Image Preview（$0.08/张）",
      "Gemini 3 Pro Image Preview（$0.12/张）",
    ]);
  });

  it("keeps every documented API family in a separate connection group", () => {
    expect(MIKOTO_GROUPS.map((group) => group.id)).toEqual([
      "生图（1k）",
      "生图（原生4k",
      "grok生图",
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
      "香蕉2 1k2k",
      "香蕉pro 1k2k",
      "gemini-2.5-flash-image",
      "香蕉2.5flash无4k",
      MIKOTO_SEEDANCE_GROUP,
      MIKOTO_KLING_GROUP,
      "Sora 视频",
    ]);
    expect(mikotoGroup("香蕉2")?.id).toBe("香蕉2 1k2k");
    expect(mikotoGroup("香蕉pro")?.id).toBe("香蕉pro 1k2k");
    expect(mikotoGroup("香蕉2 1k2k")?.models[0]?.parameters?.[0]?.options).toEqual([
      { label: "1K", value: "1K" },
      { label: "2K", value: "2K" },
    ]);
    expect(
      mikotoGroup(MIKOTO_IMAGE_GROUP)?.models.map((model) => model.id),
    ).toEqual(["gpt-image-2"]);
    expect(
      mikotoGroup(MIKOTO_IMAGE_GROUP)?.models[0]?.parameters?.[0]?.options?.map(
        (option) => option.value,
      ),
    ).toEqual(
      expect.arrayContaining([
        "2560x1097",
        "1920x1440",
        "1152x2048",
        "3840x1646",
        "2880x2160",
      ]),
    );
    expect(
      mikotoGroup(MIKOTO_IMAGE_GROUP)
        ?.models[0]?.parameters?.[0]?.options?.filter((option) =>
          option.label.startsWith("4K"),
        )
        .map((option) => option.value),
    ).toEqual([
      "2160x2160",
      "3840x2160",
      "2160x3840",
      "2880x2160",
      "2160x2880",
      "3240x2160",
      "2160x3240",
      "3840x1646",
    ]);
    expect(
      mikotoGroup(MIKOTO_IMAGE_GROUP)?.models[0]?.parameters?.[0]?.max,
    ).toBe(3840);
    expect(
      mikotoGroup(MIKOTO_IMAGE_GROUP)?.models[0]?.parameters?.[0]?.default,
    ).toBe("auto");
    expect(
      mikotoGroup(MIKOTO_GEMINI_GROUP)?.models[0]?.parameters?.find(
        (parameter) => parameter.key === "image_size",
      )?.default,
    ).toBe("4K");
    expect(
      mikotoGroup("香蕉2 1k2k")?.models[0]?.parameters?.find(
        (parameter) => parameter.key === "image_size",
      )?.default,
    ).toBe("2K");
    expect(
      mikotoGroup(MIKOTO_IMAGE_GROUP)
        ?.models[0]?.parameters?.[0]?.options?.filter((option) =>
          option.label.startsWith("2K"),
        )
        .map((option) => option.value),
    ).toEqual([
      "1440x1440",
      "2560x1440",
      "1152x2048",
      "1920x1440",
      "1440x1920",
      "2160x1440",
      "1440x2160",
      "2560x1097",
    ]);
    expect(
      mikotoGroup(MIKOTO_IMAGE_GROUP)?.models[0]?.parameters?.find(
        (parameter) => parameter.key === "quality",
      )?.options,
    ).toEqual([
      { label: "自动", value: "auto" },
      { label: "高", value: "high" },
    ]);
    expect(
      mikotoGroup(MIKOTO_SEEDANCE_GROUP)?.models.map((model) => model.id),
    ).toEqual([
      "seedance-2.0-1080p",
      "seedance-2.0-720p",
      "seedance-fast-480p",
      "seedance-fast-720p",
    ]);
    const seedanceConnector = mikotoConnectorForGroup(MIKOTO_SEEDANCE_GROUP);
    expect(seedanceConnector.models?.map((model) => model.id)).toEqual([
      "seedance-2.0-1080p",
      "seedance-2.0-720p",
      "seedance-fast-480p",
      "seedance-fast-720p",
    ]);
    expect(
      mikotoGroup(MIKOTO_KLING_GROUP)?.models.map((model) => model.id),
    ).toEqual(["kling-video", "kling-omni-video"]);
  });

  it("submits and polls asynchronous image generation", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/images/generations/async")) {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer mikoto-secret",
          );
          expect(JSON.parse(String(init?.body))).toMatchObject({
            model: "gpt-image-2",
            prompt: "A blue square",
            n: 1,
            response_format: "url",
          });
          return jsonResponse({ task_id: "img-1", status: "running" });
        }
        expect(url).toBe("https://api.mikoto.vip/v1/images/tasks/img-1");
        return jsonResponse({
          task_id: "img-1",
          status: "success",
          result: { data: [{ url: "https://cdn.test/image.png" }] },
        });
      },
    ) as unknown as typeof fetch;
    const provider = adapter(fetchMock);
    const submitted = await provider.submit({
      connectionId: "mikoto",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "A blue square",
      idempotencyKey: "mikoto-image-1",
      parameters: { size: "1024x1024", quality: "auto" },
    });
    expect(submitted).toMatchObject({
      providerTaskId: "img-1",
      status: "running",
    });
    const completed = await provider.poll(submitted);
    expect(completed.status).toBe("succeeded");
    expect(await provider.extractOutputs(completed.result)).toEqual([
      {
        kind: "image",
        url: "https://cdn.test/image.png",
        mimeType: "image/png",
      },
    ]);
  });

  it("exposes the common 2K sizes for the Grok group", () => {
    expect(
      mikotoGroup("grok生图")?.models[0]?.parameters?.find(
        (parameter) => parameter.key === "size",
      )?.options?.map((option) => option.value),
    ).toEqual([
      "auto",
      "1024x1024",
      "1440x1440",
      "2560x1440",
      "1152x2048",
      "1920x1440",
      "1440x1920",
      "2160x1440",
      "1440x2160",
      "2560x1097",
    ]);
  });

  it("passes a Grok 2K size through the async image request", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: MIKOTO_GROK_MODEL,
          prompt: "A red apple on a white table",
          size: "2560x1440",
          quality: "high",
          n: 1,
          response_format: "url",
        });
        return jsonResponse({ task_id: "grok-2k-1", status: "queued" });
      },
    ) as unknown as typeof fetch;
    const provider = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "mikoto-grok",
          provider: "rest",
          apiKey: "mikoto-secret",
          baseUrl: "https://api.mikoto.vip",
        },
      ]),
      { config: mikotoConnectorForGroup(MIKOTO_GROK_GROUP), fetch: fetchMock },
    );

    await expect(
      provider.submit({
        connectionId: "mikoto-grok",
        operation: "image.generate",
        model: MIKOTO_GROK_MODEL,
        prompt: "A red apple on a white table",
        idempotencyKey: "mikoto-grok-2k-1",
        parameters: { size: "2560x1440", quality: "high" },
      }),
    ).resolves.toMatchObject({
      providerTaskId: "grok-2k-1",
      status: "queued",
    });
  });

  it("sends every documented 4K base size with high quality unchanged", async () => {
    const documented4KSizes = [
      "2160x2160",
      "3840x2160",
      "2160x3840",
      "2880x2160",
      "2160x2880",
      "3240x2160",
      "2160x3240",
      "3840x1646",
    ];
    const received: Array<{ size: string; quality: string }> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          size: string;
          quality: string;
        };
        received.push({ size: body.size, quality: body.quality });
        return jsonResponse({
          task_id: `image-${received.length}`,
          status: "queued",
        });
      },
    ) as unknown as typeof fetch;
    const provider = adapter(fetchMock);

    for (const size of documented4KSizes) {
      await provider.submit({
        connectionId: "mikoto",
        operation: "image.generate",
        model: "gpt-image-2",
        prompt: `MikotoPro 4K mapping test ${size}`,
        idempotencyKey: `mikoto-4k-${size}`,
        parameters: { size, quality: "high" },
      });
    }

    expect(received).toEqual(
      documented4KSizes.map((size) => ({ size, quality: "high" })),
    );
  });

  it("switches image editing to Mikoto's multipart endpoint", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://api.mikoto.vip/v1/images/edits/async",
        );
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("gpt-image-2");
        expect(form.get("prompt")).toBe("Make it monochrome");
        const image = form.get("image");
        expect(image).toBeInstanceOf(Blob);
        expect(new Uint8Array(await (image as Blob).arrayBuffer())).toEqual(
          new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        );
        return jsonResponse({ task_id: "edit-1", status: "running" });
      },
    ) as unknown as typeof fetch;
    const submitted = await adapter(fetchMock).submit({
      connectionId: "mikoto",
      operation: "image.edit",
      model: "gpt-image-2",
      prompt: "Make it monochrome",
      idempotencyKey: "mikoto-edit-1",
      assets: [
        {
          id: "source",
          kind: "image",
          mimeType: "image/png",
          filename: "source.png",
          data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        },
      ],
    });
    expect(submitted.providerTaskId).toBe("edit-1");
  });

  it("maps Seedance reference media and content_url output", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/videos")) {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            model: "seedance-fast-480p",
            duration: 4,
            aspect_ratio: "16:9",
            reference_mode: "frame",
            images: ["https://cdn.test/frame.png"],
            referenceVideos: ["https://cdn.test/reference.mp4"],
            referenceAudios: ["https://cdn.test/reference.mp3"],
          });
          return jsonResponse({ id: "video-1", status: "queued" });
        }
        expect(url).toBe("https://api.mikoto.vip/v1/videos/video-1");
        return jsonResponse({
          id: "video-1",
          status: "completed",
          content_url: "https://cdn.test/result.mp4",
        });
      },
    ) as unknown as typeof fetch;
    const provider = adapter(fetchMock);
    const submitted = await provider.submit({
      connectionId: "mikoto",
      operation: "video.image-to-video",
      model: "seedance-fast-480p",
      prompt: "Animate the frame",
      idempotencyKey: "mikoto-video-1",
      parameters: { duration: 4, aspect_ratio: "16:9", generate_audio: true },
      assets: [
        {
          id: "frame",
          kind: "image",
          role: "firstFrame",
          mimeType: "image/png",
          url: "https://cdn.test/frame.png",
        },
        {
          id: "reference-video",
          kind: "video",
          mimeType: "video/mp4",
          url: "https://cdn.test/reference.mp4",
        },
        {
          id: "reference-audio",
          kind: "audio",
          mimeType: "audio/mpeg",
          url: "https://cdn.test/reference.mp3",
        },
      ],
    });
    expect(submitted.status).toBe("queued");
    const completed = await provider.poll(submitted);
    expect(completed.status).toBe("succeeded");
    expect(await provider.extractOutputs(completed.result)).toEqual([
      {
        kind: "video",
        url: "https://cdn.test/result.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });

  it("automatically uses Seedance media mode only for three or more images", async () => {
    const modes: string[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          reference_mode: string;
        };
        modes.push(body.reference_mode);
        return jsonResponse({
          id: `seedance-${modes.length}`,
          status: "queued",
        });
      },
    ) as unknown as typeof fetch;
    const provider = adapter(fetchMock);
    const asset = (id: string) => ({
      id,
      kind: "image" as const,
      mimeType: "image/png",
      url: `https://cdn.test/${id}.png`,
    });
    await provider.submit({
      connectionId: "mikoto",
      operation: "video.image-to-video",
      model: "seedance-fast-480p",
      prompt: "Animate one image",
      idempotencyKey: "seedance-frame",
      parameters: { duration: 4, aspect_ratio: "16:9" },
      assets: [asset("one")],
    });
    await provider.submit({
      connectionId: "mikoto",
      operation: "video.image-to-video",
      model: "seedance-fast-480p",
      prompt: "Blend three images",
      idempotencyKey: "seedance-media",
      parameters: { duration: 4, aspect_ratio: "16:9" },
      assets: [asset("one"), asset("two"), asset("three")],
    });
    expect(modes).toEqual(["frame", "media"]);
  });

  it("maps Kling messages, mirrored parameters, task-id fallback, and video output", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/videos")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            model: "kling-omni-video",
            prompt: "Rotate both products in a white studio",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Rotate both products in a white studio",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: "https://cdn.test/product-1.png",
                      detail: "high",
                    },
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: "https://cdn.test/product-2.png",
                      detail: "high",
                    },
                  },
                ],
              },
            ],
            seconds: "10",
            duration: 10,
            aspect_ratio: "9:16",
            aspectRatio: "9:16",
            resolution: "1080p",
            size: "1080x1920",
            reference_mode: "element",
            extra_body: {
              seconds: 10,
              duration: 10,
              aspect_ratio: "9:16",
              aspectRatio: "9:16",
              resolution: "1080p",
              size: "1080x1920",
              reference_mode: "element",
            },
          });
          return jsonResponse({ task_id: "kling-1", status: "queued" });
        }
        expect(url).toBe("https://api.mikoto.vip/v1/videos/kling-1");
        return jsonResponse({
          data: {
            status: "succeeded",
            result_url: "/generated-video/kling-1.mp4",
          },
        });
      },
    ) as unknown as typeof fetch;
    const provider = adapter(fetchMock);
    const submitted = await provider.submit({
      connectionId: "mikoto",
      operation: "video.image-to-video",
      model: "kling-omni-video",
      prompt: "Rotate both products in a white studio",
      idempotencyKey: "mikoto-kling-1",
      parameters: {
        duration: 10,
        aspect_ratio: "9:16",
        resolution: "1080p",
      },
      assets: [
        {
          id: "product-1",
          kind: "image",
          mimeType: "image/png",
          url: "https://cdn.test/product-1.png",
        },
        {
          id: "product-2",
          kind: "image",
          mimeType: "image/png",
          url: "https://cdn.test/product-2.png",
        },
      ],
    });
    expect(submitted).toMatchObject({
      providerTaskId: "kling-1",
      status: "queued",
    });
    const completed = await provider.poll(submitted);
    expect(completed.status).toBe("succeeded");
    expect(await provider.extractOutputs(completed.result)).toEqual([
      {
        kind: "video",
        url: "https://api.mikoto.vip/generated-video/kling-1.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });

  it("maps Sora primary and reference media fields from the documented payload", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/videos")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            model: "sora-v3-pro",
            prompt: "Create a cinematic product shot",
            seconds: "8",
            aspect_ratio: "16:9",
            resolution: "720p",
            image_url: "https://cdn.test/primary.png",
            reference_image_urls: ["https://cdn.test/reference.png"],
            reference_videos: [
              "https://cdn.test/primary.mp4",
              "https://cdn.test/reference.mp4",
            ],
            audio_url: "https://cdn.test/reference.mp3",
            video_config: { reference_mode: "auto" },
          });
          return jsonResponse({ id: "sora-1", status: "queued" });
        }
        expect(url).toBe("https://api.mikoto.vip/v1/videos/sora-1");
        return jsonResponse({
          id: "sora-1",
          status: "completed",
          content_url: "https://cdn.test/sora.mp4",
        });
      },
    ) as unknown as typeof fetch;
    const provider = adapter(fetchMock);
    const submitted = await provider.submit({
      connectionId: "mikoto",
      operation: "video.generate",
      model: "sora-v3-pro",
      prompt: "Create a cinematic product shot",
      idempotencyKey: "mikoto-sora-1",
      parameters: { duration: 8, aspect_ratio: "16:9", resolution: "720p" },
      assets: [
        {
          id: "primary-image",
          kind: "image",
          mimeType: "image/png",
          url: "https://cdn.test/primary.png",
        },
        {
          id: "reference-image",
          kind: "image",
          mimeType: "image/png",
          url: "https://cdn.test/reference.png",
        },
        {
          id: "primary-video",
          kind: "video",
          mimeType: "video/mp4",
          url: "https://cdn.test/primary.mp4",
        },
        {
          id: "reference-video",
          kind: "video",
          mimeType: "video/mp4",
          url: "https://cdn.test/reference.mp4",
        },
        {
          id: "reference-audio",
          kind: "audio",
          mimeType: "audio/mpeg",
          url: "https://cdn.test/reference.mp3",
        },
      ],
    });
    expect(submitted).toMatchObject({
      providerTaskId: "sora-1",
      status: "queued",
    });
    const completed = await provider.poll(submitted);
    expect(completed.status).toBe("succeeded");
    expect(await provider.extractOutputs(completed.result)).toEqual([
      {
        kind: "video",
        url: "https://cdn.test/sora.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });
});
