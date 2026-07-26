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
