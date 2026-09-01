import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { StaticConnectionResolver } from "./credentials";
import type { RestConnectorConfig } from "./rest";
import { GenericRestAdapter } from "./rest";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const asyncConfig: RestConnectorConfig = {
  auth: { type: "header", headerName: "X-API-Key" },
  allowedHosts: ["provider.test"],
  submit: {
    path: "/generate",
    method: "POST",
    bodyMode: "json",
    template: { request: {} },
    mappings: [
      {
        target: "/request/prompt",
        source: { kind: "request", path: "$.prompt" },
      },
      {
        target: "/request/image",
        source: { kind: "request", path: "$.assets[0].url" },
        omitIfUndefined: true,
      },
    ],
    response: { taskIdPath: "$.job.id", statusPath: "$.job.state" },
  },
  poll: {
    path: "/jobs/{taskId}",
    method: "GET",
    bodyMode: "none",
    response: {
      statusPath: "$.job.state",
      progressPath: "$.job.progress",
      errorPath: "$.job.error",
    },
  },
  output: {
    path: "$.outputs[*]",
    kind: "image",
    urlPath: "$.url",
    mimeTypePath: "$.mime",
  },
  statusMap: { ACCEPTED: "running", COMPLETE: "succeeded" },
};

describe("GenericRestAdapter", () => {
  it("accepts large synchronous Base64 image responses above the metadata limit", async () => {
    const encoded = Buffer.from("large-image-result").toString("base64");
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: encoded }],
        providerMetadata: "x".repeat(16 * 1024 * 1024),
      }),
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      submit: { path: "/v1/images/generations", bodyMode: "json" },
      output: {
        path: "$.data",
        kind: "image",
        base64Path: "b64_json",
        defaultMimeType: "image/png",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        { id: "rest", provider: "rest", baseUrl: "https://provider.test" },
      ]),
      { config, fetch: fetchMock },
    );

    const submitted = await adapter.submit({
      connectionId: "rest",
      operation: "image.generate",
      prompt: "A detailed 4K poster",
      idempotencyKey: "large-base64-response",
      parameters: { n: 1 },
    });

    await expect(adapter.extractOutputs(submitted.result)).resolves.toEqual([
      {
        kind: "image",
        data: new Uint8Array(Buffer.from("large-image-result")),
        mimeType: "image/png",
      },
    ]);
  });

  it("maps a normalized request, polls, and safely extracts outputs", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/generate")) {
          expect(new Headers(init?.headers).get("x-api-key")).toBe(
            "rest-secret",
          );
          expect(JSON.parse(String(init?.body))).toEqual({
            request: {
              prompt: "A tiny observatory",
              image: "https://assets.test/reference.png",
            },
          });
          return jsonResponse({ job: { id: "job-7", state: "ACCEPTED" } });
        }
        expect(url).toBe("https://provider.test/jobs/job-7");
        return jsonResponse({
          job: { id: "job-7", state: "COMPLETE", progress: 1 },
          outputs: [{ url: "https://cdn.test/result.png", mime: "image/png" }],
        });
      },
    ) as unknown as typeof fetch;
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          apiKey: "rest-secret",
          baseUrl: "https://provider.test/v1/",
        },
      ]),
      { fetch: fetchMock, config: asyncConfig },
    );
    const submitted = await adapter.submit({
      connectionId: "rest",
      operation: "image.edit",
      prompt: "A tiny observatory",
      idempotencyKey: "idem-4",
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          url: "https://assets.test/reference.png",
        },
      ],
    });
    expect(submitted).toMatchObject({
      providerTaskId: "job-7",
      status: "running",
    });
    const completed = await adapter.poll(submitted);
    expect(completed).toMatchObject({ status: "succeeded", progress: 1 });
    expect(await adapter.extractOutputs(completed.result)).toEqual([
      {
        kind: "image",
        url: "https://cdn.test/result.png",
        mimeType: "image/png",
      },
    ]);
  });

  it("encodes Gemini native image parts and extracts inline_data", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer gemini-secret",
        );
        const body = JSON.parse(String(init?.body));
        if (body.contents[0].parts[0].text === "使用自动参数") {
          expect(body).toEqual({
            contents: [{ role: "user", parts: [{ text: "使用自动参数" }] }],
            generationConfig: {
              responseModalities: ["IMAGE", "TEXT"],
              imageConfig: {},
            },
          });
        } else {
          expect(body).toEqual({
            contents: [
              {
                role: "user",
                parts: [
                  { text: "保留构图，改成水彩风" },
                  {
                    inline_data: {
                      mime_type: "image/png",
                      data: "AQID",
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ["IMAGE", "TEXT"],
              imageConfig: { aspectRatio: "4:3", imageSize: "2K" },
            },
          });
        }
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inline_data: {
                      mime_type: "image/png",
                      data: Buffer.from("gemini-result").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        });
      },
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "bearer" },
      allowedHosts: ["provider.test"],
      restrictModels: true,
      models: [
        {
          id: "gemini-image",
          name: "Gemini image",
          operations: ["image.generate", "image.edit"],
          limits: { maxInputImages: 1 },
        },
      ],
      submit: {
        path: "/v1beta/models/gemini-image:generateContent",
        bodyMode: "json",
        template: {
          contents: [{ role: "user", parts: [{ text: "" }] }],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: {},
          },
        },
        mappings: [
          {
            target: "/contents/0/parts/0/text",
            source: { kind: "request", path: "$.prompt" },
          },
          {
            target: "/contents/0/parts/1",
            source: {
              kind: "assets",
              assetKind: "image",
              select: "first",
              encoding: "gemini-part",
            },
            omitIfUndefined: true,
          },
          {
            target: "/generationConfig/imageConfig/aspectRatio",
            source: { kind: "request", path: "$.parameters.aspectRatio" },
            omitValues: ["auto"],
          },
          {
            target: "/generationConfig/imageConfig/imageSize",
            source: { kind: "request", path: "$.parameters.imageSize" },
            omitValues: ["auto"],
          },
        ],
      },
      output: {
        path: "$.candidates[0].content.parts",
        kind: "image",
        base64Path: "inline_data.data",
        mimeTypePath: "inline_data.mime_type",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "gemini",
          provider: "rest",
          apiKey: "gemini-secret",
          baseUrl: "https://provider.test",
        },
      ]),
      { fetch: fetchMock, config },
    );
    const submitted = await adapter.submit({
      connectionId: "gemini",
      operation: "image.edit",
      prompt: "保留构图，改成水彩风",
      idempotencyKey: "gemini-edit-1",
      model: "gemini-image",
      parameters: { aspectRatio: "4:3", imageSize: "2K" },
      assets: [
        {
          id: "input",
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    expect(submitted.status).toBe("succeeded");
    expect(await adapter.extractOutputs(submitted.result)).toEqual([
      {
        kind: "image",
        data: new Uint8Array(Buffer.from("gemini-result")),
        mimeType: "image/png",
      },
    ]);
    await expect(
      adapter.submit({
        connectionId: "gemini",
        operation: "image.generate",
        prompt: "使用自动参数",
        idempotencyKey: "gemini-auto-1",
        model: "gemini-image",
        parameters: { aspectRatio: "auto", imageSize: "auto" },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("extracts a Gemini data URI returned in parts text", async () => {
    const config: RestConnectorConfig = {
      auth: { type: "bearer" },
      allowedHosts: ["provider.test"],
      submit: { path: "/generate", method: "POST", bodyMode: "json" },
      output: {
        path: "$.candidates[0].content.parts",
        kind: "image",
        urlPath: "file_data.file_uri",
        urlFallbackPaths: ["fileData.fileUri"],
        base64Path: "inline_data.data",
        base64FallbackPaths: ["inlineData.data", "text"],
        mimeTypePath: "inline_data.mime_type",
        defaultMimeType: "image/png",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "gemini-text",
          provider: "rest",
          apiKey: "gemini-secret",
          baseUrl: "https://provider.test",
        },
      ]),
      { config },
    );
    const encoded = Buffer.from("gemini-text-result").toString("base64");

    expect(
      await adapter.extractOutputs({
        config,
        remote: {
          candidates: [
            {
              content: {
                parts: [
                  { text: `![generated](data:image/webp;base64,${encoded})` },
                ],
              },
            },
          ],
        },
      }),
    ).toEqual([
      {
        kind: "image",
        data: new Uint8Array(Buffer.from("gemini-text-result")),
        mimeType: "image/webp",
      },
    ]);
  });

  it("builds OpenAI messages, coerces mirrored fields, and accepts a fallback task id", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Animate the product" },
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64,AQID",
                    detail: "high",
                  },
                },
              ],
            },
          ],
          duration: 10,
          seconds: "10",
        });
        return jsonResponse({ task_id: "task-fallback", status: "queued" });
      },
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      submit: {
        path: "/v1/videos",
        bodyMode: "json",
        mappings: [
          { target: "/messages", source: { kind: "openaiMessages" } },
          {
            target: "/duration",
            source: { kind: "request", path: "$.parameters.duration" },
          },
          {
            target: "/seconds",
            source: { kind: "request", path: "$.parameters.duration" },
            coerce: "string",
          },
        ],
        response: {
          taskIdPath: "$.id",
          taskIdFallbackPaths: ["$.task_id"],
          statusPath: "$.status",
        },
      },
      poll: { path: "/v1/videos/{taskId}", bodyMode: "none" },
      output: { path: "$.content_url", kind: "video" },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        { id: "messages", provider: "rest", baseUrl: "https://provider.test" },
      ]),
      { config, fetch: fetchMock },
    );

    await expect(
      adapter.submit({
        connectionId: "messages",
        operation: "video.image-to-video",
        prompt: "Animate the product",
        idempotencyKey: "messages-1",
        parameters: { duration: 10 },
        assets: [
          {
            id: "product",
            kind: "image",
            mimeType: "image/png",
            data: new Uint8Array([1, 2, 3]),
          },
        ],
      }),
    ).resolves.toMatchObject({
      providerTaskId: "task-fallback",
      status: "queued",
    });
  });

  it("uses a nested fallback status path for wrapped async responses", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/submit"))
        return jsonResponse({ task_id: "wrapped-1", status: "queued" });
      return jsonResponse({
        data: { status: "SUCCESS" },
        result_url: "/video.mp4",
      });
    }) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      submit: {
        path: "/submit",
        bodyMode: "json",
        response: { taskIdPath: "$.task_id", statusPath: "$.status" },
      },
      poll: {
        path: "/tasks/{taskId}",
        bodyMode: "none",
        response: {
          statusPath: "$.status",
          statusFallbackPaths: ["$.data.status"],
        },
      },
      output: { path: "$.result_url", kind: "video" },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        { id: "wrapped", provider: "rest", baseUrl: "https://provider.test" },
      ]),
      { fetch: fetchMock, config },
    );
    const submitted = await adapter.submit({
      connectionId: "wrapped",
      operation: "video.generate",
      prompt: "test",
      idempotencyKey: "wrapped-1",
    });
    expect((await adapter.poll(submitted)).status).toBe("succeeded");
  });

  it("handles synchronous output responses without a task id", async () => {
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["sync.test"],
      submit: {
        path: "https://sync.test/generate",
        bodyMode: "json",
        mappings: [
          { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
        ],
      },
      output: {
        path: "$.data[*].url",
        kind: "video",
        defaultMimeType: "video/mp4",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        { id: "sync", provider: "rest", baseUrl: "https://sync.test" },
      ]),
      {
        config,
        fetch: (async () =>
          jsonResponse({
            data: [{ url: "/v1/videos/movie.mp4" }],
          })) as typeof fetch,
      },
    );
    const submitted = await adapter.submit({
      connectionId: "sync",
      operation: "video.generate",
      prompt: "Clouds moving over a mountain",
      idempotencyKey: "idem-5",
    });
    expect(submitted.status).toBe("succeeded");
    expect(await adapter.extractOutputs(submitted.result)).toEqual([
      {
        kind: "video",
        url: "https://sync.test/v1/videos/movie.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });

  it("snaps unsupported aspect ratios to the closest model option", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual(
          body.prompt === "Create an A4 flyer"
            ? {
                model: "image-model",
                prompt: "Create an A4 flyer",
                aspect_ratio: "2:3",
              }
            : {
                model: "image-model",
                prompt: "Follow the ultra-wide reference",
                aspect_ratio: "21:9",
              },
        );
        return jsonResponse({ output: "https://cdn.test/a4.png" });
      },
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      restrictModels: true,
      models: [
        {
          id: "image-model",
          name: "Image model",
          operations: ["image.generate"],
          parameters: [
            {
              key: "aspect_ratio",
              label: "Aspect ratio",
              control: "select",
              options: [
                { label: "Auto", value: "auto" },
                { label: "3:4", value: "3:4" },
                { label: "2:3", value: "2:3" },
                { label: "21:9", value: "21:9" },
              ],
            },
          ],
        },
      ],
      submit: {
        path: "/generate",
        bodyMode: "json",
        mappings: [
          { target: "/model", source: { kind: "request", path: "$.model" } },
          {
            target: "/prompt",
            source: { kind: "request", path: "$.prompt" },
          },
          {
            target: "/aspect_ratio",
            source: { kind: "request", path: "$.parameters.aspect_ratio" },
          },
        ],
      },
      output: { path: "$.output", kind: "image" },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          baseUrl: "https://provider.test",
        },
      ]),
      { config, fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "rest",
      operation: "image.generate",
      model: "image-model",
      prompt: "Create an A4 flyer",
      idempotencyKey: "nearest-a4",
      parameters: { aspect_ratio: "70:99" },
    });
    await adapter.submit({
      connectionId: "rest",
      operation: "image.generate",
      model: "image-model",
      prompt: "Follow the ultra-wide reference",
      idempotencyKey: "nearest-ultra-wide",
      parameters: { aspect_ratio: "161:40" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back across documented output locations", async () => {
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      submit: { path: "/v1/videos", bodyMode: "json" },
      output: {
        path: "$.video_url",
        fallbackPaths: ["$.metadata.video_url", "$.metadata.url"],
        kind: "video",
        defaultMimeType: "video/mp4",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        { id: "rest", provider: "rest", baseUrl: "https://provider.test" },
      ]),
      { config },
    );

    await expect(
      adapter.extractOutputs({
        connectionId: "rest",
        config,
        remote: { metadata: { url: "/completed/movie.mp4" } },
      }),
    ).resolves.toEqual([
      {
        kind: "video",
        url: "https://provider.test/completed/movie.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });

  it("recovers historical video tasks saved with the old output mapping", async () => {
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      submit: { path: "/v1/videos", bodyMode: "json" },
      output: {
        path: "$.metadata.video_url",
        kind: "video",
        defaultMimeType: "video/mp4",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        { id: "rest", provider: "rest", baseUrl: "https://provider.test" },
      ]),
      { config },
    );

    await expect(
      adapter.extractOutputs({
        connectionId: "rest",
        config,
        remote: { video_url: "/historical/movie.mp4" },
      }),
    ).resolves.toEqual([
      {
        kind: "video",
        url: "https://provider.test/historical/movie.mp4",
        mimeType: "video/mp4",
      },
    ]);
  });

  it("uses model-specific transports and filters assets by kind and role", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://provider.test/v1/videos");
        expect(JSON.parse(String(init?.body))).toEqual({
          model: "video-model",
          reference_mode: "frame",
          images: ["data:image/png;base64,AQID"],
          first_image_url: "data:image/png;base64,BAU=",
          reference_videos: ["https://assets.test/reference.mp4"],
          reference_audios: ["https://assets.test/reference.mp3"],
        });
        return jsonResponse({ id: "video-1", status: "queued" });
      },
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      restrictModels: true,
      models: [
        {
          id: "image-model",
          name: "Image",
          operations: ["image.generate"],
        },
        {
          id: "video-model",
          name: "Video",
          operations: ["video.generate", "video.image-to-video"],
          limits: {
            maxInputImages: 2,
            maxInputVideos: 1,
            maxInputAudios: 1,
          },
        },
      ],
      submit: { path: "/v1/images/generations", bodyMode: "json" },
      output: { path: "$.data", kind: "image" },
      modelOverrides: {
        "video-model": {
          submit: {
            path: "/v1/videos",
            bodyMode: "json",
            mappings: [
              {
                target: "/model",
                source: { kind: "request", path: "$.model" },
              },
              {
                target: "/reference_mode",
                source: {
                  kind: "assetMode",
                  frameValue: "frame",
                  referenceValue: "media",
                },
              },
              {
                target: "/images",
                source: {
                  kind: "assets",
                  assetKind: "image",
                  role: "reference",
                },
                omitIfEmpty: true,
              },
              {
                target: "/first_image_url",
                source: {
                  kind: "assets",
                  assetKind: "image",
                  role: "firstFrame",
                  select: "first",
                },
                omitIfUndefined: true,
              },
              {
                target: "/reference_videos",
                source: { kind: "assets", assetKind: "video" },
                omitIfEmpty: true,
              },
              {
                target: "/reference_audios",
                source: { kind: "assets", assetKind: "audio" },
                omitIfEmpty: true,
              },
            ],
            response: { taskIdPath: "$.id", statusPath: "$.status" },
          },
          poll: {
            path: "/v1/videos/{taskId}",
            bodyMode: "none",
          },
          output: {
            path: "$.video_url",
            kind: "video",
            defaultMimeType: "video/mp4",
          },
        },
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          baseUrl: "https://provider.test/v1/",
        },
      ]),
      { config, fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "rest",
      operation: "video.image-to-video",
      model: "video-model",
      prompt: "Animate the references",
      idempotencyKey: "video-override",
      assets: [
        {
          id: "reference",
          kind: "image",
          role: "reference",
          mimeType: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
        {
          id: "first",
          kind: "image",
          role: "firstFrame",
          mimeType: "image/png",
          data: new Uint8Array([4, 5]),
        },
        {
          id: "video",
          kind: "video",
          mimeType: "video/mp4",
          url: "https://assets.test/reference.mp4",
        },
        {
          id: "audio",
          kind: "audio",
          mimeType: "audio/mpeg",
          url: "https://assets.test/reference.mp3",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("supports conditional asset selection for single-versus-array provider fields", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        many: ["https://assets.test/one.mp3", "https://assets.test/two.mp3"],
      });
      return jsonResponse({ id: "selection-1", status: "queued" });
    }) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      submit: {
        path: "/v1/test",
        bodyMode: "json",
        mappings: [
          {
            target: "/single",
            source: { kind: "assets", assetKind: "audio", select: "firstIfOnly" },
            omitIfUndefined: true,
          },
          {
            target: "/many",
            source: { kind: "assets", assetKind: "audio", select: "allIfMultiple" },
            omitIfUndefined: true,
          },
        ],
      },
      output: { path: "$.data", kind: "image" },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        { id: "rest", provider: "rest", baseUrl: "https://provider.test" },
      ]),
      { config, fetch: fetchMock },
    );
    await adapter.submit({
      connectionId: "rest",
      operation: "image.generate",
      model: "selection-model",
      prompt: "selection",
      idempotencyKey: "selection-1",
      assets: [
        { id: "one", kind: "audio", mimeType: "audio/mpeg", url: "https://assets.test/one.mp3" },
        { id: "two", kind: "audio", mimeType: "audio/mpeg", url: "https://assets.test/two.mp3" },
      ],
    });
  });

  it("uses operation-specific transports for models that generate and edit", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://provider.test/v1/images/edits/async",
        );
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get("prompt")).toBe("Restyle the reference");
        expect(form.get("model")).toBe("shared-image-model");
        expect(form.get("image")).toBe("https://assets.test/reference.png");
        return jsonResponse({ task_id: "edit-1", status: "running" });
      },
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      restrictModels: true,
      models: [
        {
          id: "shared-image-model",
          name: "Shared image model",
          operations: ["image.generate", "image.edit"],
        },
      ],
      submit: {
        path: "/v1/images/generations/async",
        bodyMode: "json",
      },
      poll: { path: "/v1/images/tasks/{taskId}", bodyMode: "none" },
      output: { path: "$.result.data", kind: "image", urlPath: "url" },
      operationOverrides: {
        "image.edit": {
          submit: {
            path: "/v1/images/edits/async",
            bodyMode: "multipart",
            mappings: [
              {
                target: "/model",
                source: { kind: "request", path: "$.model" },
              },
              {
                target: "/prompt",
                source: { kind: "request", path: "$.prompt" },
              },
              {
                target: "/image",
                source: {
                  kind: "assets",
                  assetKind: "image",
                  select: "first",
                },
              },
            ],
            response: { taskIdPath: "$.task_id", statusPath: "$.status" },
          },
        },
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          baseUrl: "https://provider.test",
        },
      ]),
      { config, fetch: fetchMock },
    );

    const submitted = await adapter.submit({
      connectionId: "rest",
      operation: "image.edit",
      model: "shared-image-model",
      prompt: "Restyle the reference",
      idempotencyKey: "operation-override",
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          url: "https://assets.test/reference.png",
        },
      ],
    });

    expect(submitted).toMatchObject({
      providerTaskId: "edit-1",
      status: "running",
    });
  });

  it("uses a model-specific operation transport without affecting sibling models", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://provider.test/v1/images/edits");
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("editable-4k");
        expect(form.getAll("image[]")).toEqual([
          "https://assets.test/reference.png",
          "https://assets.test/reference-2.webp",
        ]);
        return jsonResponse({
          data: [{ url: "https://assets.test/output.png" }],
        });
      },
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["provider.test"],
      restrictModels: true,
      models: [
        {
          id: "editable-4k",
          name: "Editable 4K",
          operations: ["image.generate", "image.edit"],
          limits: { maxInputImages: 16 },
        },
        {
          id: "generate-only",
          name: "Generate only",
          operations: ["image.generate"],
        },
      ],
      submit: { path: "/v1/images/generations", bodyMode: "json" },
      output: { path: "$.data", kind: "image", urlPath: "url" },
      modelOverrides: {
        "editable-4k": {
          operationOverrides: {
            "image.edit": {
              submit: {
                path: "/v1/images/edits",
                bodyMode: "multipart",
                mappings: [
                  {
                    target: "/model",
                    source: { kind: "request", path: "$.model" },
                  },
                  {
                    target: "/image[]",
                    source: {
                      kind: "assets",
                      assetKind: "image",
                      select: "all",
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          baseUrl: "https://provider.test",
        },
      ]),
      { config, fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "rest",
      operation: "image.edit",
      model: "editable-4k",
      prompt: "Restyle",
      idempotencyKey: "model-operation-override",
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          url: "https://assets.test/reference.png",
        },
        {
          id: "reference-2",
          kind: "image",
          mimeType: "image/webp",
          url: "https://assets.test/reference-2.webp",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encodes mapped assets as data URLs and raw bytes as base64 in JSON bodies", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          asset: "data:image/webp;base64,AQID",
          bytes: "AQID",
          nested: { bytes: "BAU=" },
        });
        return jsonResponse({ output: "https://cdn.test/result.webp" });
      },
    ) as unknown as typeof fetch;
    const config: RestConnectorConfig = {
      auth: { type: "none" },
      allowedHosts: ["binary.test"],
      submit: {
        path: "https://binary.test/generate",
        bodyMode: "json",
        mappings: [
          {
            target: "/asset",
            source: { kind: "request", path: "$.assets[0]" },
          },
          {
            target: "/bytes",
            source: { kind: "request", path: "$.assets[0].data" },
          },
          {
            target: "/nested",
            source: {
              kind: "literal",
              value: { bytes: new Uint8Array([4, 5]) },
            },
          },
        ],
      },
      output: {
        path: "$.output",
        kind: "image",
        defaultMimeType: "image/webp",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([{ id: "binary", provider: "rest" }]),
      { config, fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "binary",
      operation: "image.edit",
      prompt: "Restyle it",
      idempotencyKey: "binary-json",
      assets: [
        {
          id: "source",
          kind: "image",
          mimeType: "image/webp",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a connector URL outside the allowlist before submit", async () => {
    const config: RestConnectorConfig = {
      ...asyncConfig,
      submit: {
        ...asyncConfig.submit,
        path: "https://metadata.internal/generate",
      },
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          apiKey: "secret",
          baseUrl: "https://provider.test",
        },
      ]),
      { config },
    );
    const result = await adapter.validate({
      connectionId: "rest",
      operation: "image.generate",
      prompt: "hello",
      idempotencyKey: "idem-6",
    });
    expect(result).toMatchObject({ valid: false });
    expect(result.issues[0]?.message).toContain("not allowlisted");
  });

  it("requires polling when a connector maps an asynchronous task id", async () => {
    const { poll: _poll, ...withoutPoll } = asyncConfig;
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          apiKey: "secret",
          baseUrl: "https://provider.test",
        },
      ]),
      { config: withoutPoll },
    );

    await expect(
      adapter.validate({
        connectionId: "rest",
        operation: "image.generate",
        prompt: "hello",
        idempotencyKey: "missing-poll",
      }),
    ).resolves.toMatchObject({
      valid: false,
      issues: [
        expect.objectContaining({
          message: expect.stringContaining("does not define a poll endpoint"),
        }),
      ],
    });
  });

  it("rejects operations that the selected model does not support", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const config: RestConnectorConfig = {
      ...asyncConfig,
      models: [
        {
          id: "generate-only",
          name: "Generate only",
          operations: ["image.generate"],
        },
      ],
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          apiKey: "secret",
          baseUrl: "https://provider.test",
        },
      ]),
      { config, fetch: fetchMock },
    );

    const result = await adapter.validate({
      connectionId: "rest",
      operation: "image.edit",
      model: "generate-only",
      prompt: "edit this",
      idempotencyKey: "unsupported-operation",
    });

    expect(result).toMatchObject({
      valid: false,
      issues: [
        expect.objectContaining({
          path: "operation",
          message: expect.stringContaining("does not support"),
        }),
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects models removed from a strict connector group", async () => {
    const config: RestConnectorConfig = {
      ...asyncConfig,
      restrictModels: true,
      models: [
        {
          id: "current-model",
          name: "Current model",
          operations: ["image.generate"],
        },
      ],
    };
    const adapter = new GenericRestAdapter(
      new StaticConnectionResolver([
        {
          id: "rest",
          provider: "rest",
          apiKey: "secret",
          baseUrl: "https://provider.test",
        },
      ]),
      { config },
    );

    await expect(
      adapter.validate({
        connectionId: "rest",
        operation: "image.generate",
        model: "removed-model",
        prompt: "hello",
        idempotencyKey: "removed-model",
      }),
    ).resolves.toMatchObject({
      valid: false,
      issues: [
        expect.objectContaining({
          path: "model",
          code: "unsupported_model",
        }),
      ],
    });
  });

  it.each(["poll", "cancel"] as const)(
    "rejects an unsafe %s URL during preflight",
    async (endpoint) => {
      const unsafeDefinition =
        endpoint === "poll"
          ? {
              ...asyncConfig.poll!,
              path: "https://metadata.internal/jobs/{taskId}",
            }
          : {
              path: "http://provider.test/jobs/{taskId}",
              method: "DELETE" as const,
              bodyMode: "none" as const,
            };
      const config: RestConnectorConfig = {
        ...asyncConfig,
        [endpoint]: unsafeDefinition,
      };
      const adapter = new GenericRestAdapter(
        new StaticConnectionResolver([
          {
            id: "rest",
            provider: "rest",
            apiKey: "secret",
            baseUrl: "https://provider.test",
          },
        ]),
        { config },
      );

      const result = await adapter.validate({
        connectionId: "rest",
        operation: "image.generate",
        prompt: "hello",
        idempotencyKey: `unsafe-${endpoint}`,
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.message).toContain(
        `${endpoint} endpoint is invalid`,
      );
      expect(result.issues[0]?.message).toMatch(
        endpoint === "poll" ? /not allowlisted/u : /must use HTTPS/u,
      );
    },
  );

  it("verifies and normalizes declarative HMAC webhooks", async () => {
    const config: RestConnectorConfig = {
      ...asyncConfig,
      webhook: {
        signatureHeader: "x-signature",
        signaturePrefix: "sha256=",
        taskIdPath: "$.job.id",
        statusPath: "$.job.state",
        errorPath: "$.job.error",
      },
    };
    const resolver = new StaticConnectionResolver([
      {
        id: "rest-webhook",
        provider: "rest",
        apiKey: "webhook-secret",
        baseUrl: "https://provider.test",
      },
    ]);
    const adapter = new GenericRestAdapter(resolver, { config });
    const body = JSON.stringify({ job: { id: "job-9", state: "COMPLETE" } });
    const digest = createHmac("sha256", "webhook-secret")
      .update(body)
      .digest("hex");
    const request = new Request("https://canvas.test/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": `sha256=${digest}`,
      },
      body,
    });
    await expect(
      adapter.verifyWebhook(request, "rest-webhook"),
    ).resolves.toMatchObject({
      providerTaskId: "job-9",
      status: "succeeded",
    });
    const invalid = new Request("https://canvas.test/webhook", {
      method: "POST",
      headers: { "x-signature": "sha256=bad" },
      body,
    });
    await expect(
      adapter.verifyWebhook(invalid, "rest-webhook"),
    ).rejects.toThrow("signature is invalid");
  });
});
