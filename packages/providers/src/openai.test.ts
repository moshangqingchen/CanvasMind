import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials";
import { OpenAIImageAdapter } from "./openai";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenAIImageAdapter", () => {
  it("submits an idempotent image generation and extracts base64 output", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/models"))
        return jsonResponse({ data: [{ id: "gpt-image-2" }] });
      return jsonResponse({
        data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }],
      });
    }) as unknown as typeof fetch;
    const resolver = new StaticConnectionResolver([
      {
        id: "openai",
        provider: "openai",
        apiKey: "sk-test",
        baseUrl: "https://openai.test/v1",
      },
    ]);
    const adapter = new OpenAIImageAdapter(resolver, { fetch: fetchMock });

    const task = await adapter.submit({
      connectionId: "openai",
      operation: "image.generate",
      prompt: "A ceramic moon",
      idempotencyKey: "idem-1",
      parameters: { size: "1024x1024" },
    });

    expect(task.status).toBe("succeeded");
    const [, init] = vi.mocked(fetchMock).mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("idem-1");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-image-2",
      prompt: "A ceramic moon",
      size: "1024x1024",
    });
    const outputs = await adapter.extractOutputs(task.result);
    expect(Buffer.from(outputs[0]?.data ?? []).toString()).toBe("image-bytes");
    expect(outputs[0]).toMatchObject({
      mimeType: "image/png",
      filename: "openai-1.png",
    });
  });

  it("uses the connection default model and reports it in the model list", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "custom-image-model" }] });
      }
      return jsonResponse({
        data: [{ b64_json: Buffer.from("result").toString("base64") }],
      });
    }) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "openai",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://openai.test/v1",
          settings: { defaultModel: "custom-image-model" },
        },
      ]),
      { fetch: fetchMock, defaultModel: "constructor-fallback" },
    );

    const models = await adapter.listModels("openai");
    expect(
      models.find((model) => model.id === "custom-image-model")?.isDefault,
    ).toBe(true);

    await adapter.submit({
      connectionId: "openai",
      operation: "image.generate",
      prompt: "A paper city",
      idempotencyKey: "configured-model",
    });
    const generationCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/generations"));
    expect(JSON.parse(String(generationCall?.[1]?.body))).toMatchObject({
      model: "custom-image-model",
    });
  });

  it("maps aspect ratios to valid sizes and only sends compression for lossy formats", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ b64_json: Buffer.from("result").toString("base64") }],
      }),
    ) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "openai",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://openai.test/v1",
        },
      ]),
      { fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "openai",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "A wide cinematic scene",
      idempotencyKey: "aspect-ratio",
      parameters: {
        aspect_ratio: "16:9",
        output_format: "png",
        output_compression: 50,
      },
    });
    const pngBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body),
    );
    expect(pngBody).toMatchObject({ size: "1360x768", output_format: "png" });
    expect(pngBody).not.toHaveProperty("aspect_ratio");
    expect(pngBody).not.toHaveProperty("output_compression");

    await adapter.submit({
      connectionId: "openai",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "A square product photo",
      idempotencyKey: "lossy-compression",
      parameters: {
        aspect_ratio: "1:1",
        output_format: "webp",
        output_compression: 72,
      },
    });
    const webpBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[1]?.[1]?.body),
    );
    expect(webpBody).toMatchObject({
      size: "1024x1024",
      output_format: "webp",
      output_compression: 72,
    });
  });

  it("labels encoded and URL outputs using their actual or requested format", async () => {
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver());
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const encoded = await adapter.extractOutputs({
      response: {
        data: [{ b64_json: Buffer.from(jpegBytes).toString("base64") }],
      },
      outputFormat: "webp",
    });
    expect(encoded[0]).toMatchObject({
      mimeType: "image/jpeg",
      filename: "openai-1.jpeg",
    });

    const fromUrl = await adapter.extractOutputs({
      response: { data: [{ url: "https://output.test/final.webp?expires=1" }] },
      outputFormat: "png",
    });
    expect(fromUrl).toEqual([
      {
        kind: "image",
        url: "https://output.test/final.webp?expires=1",
        mimeType: "image/webp",
        filename: "openai-1.webp",
      },
    ]);
  });

  it("uses multipart for an image edit", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBeInstanceOf(FormData);
        expect(new Headers(init?.headers).get("content-type")).toBeNull();
        const form = init?.body as FormData;
        expect(form.get("prompt")).toBe("Turn it into stained glass");
        expect(form.get("image")).toBeInstanceOf(Blob);
        return jsonResponse({
          data: [{ url: "https://output.test/edit.png" }],
        });
      },
    ) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "openai",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://openai.test/v1",
          headers: { "Content-Type": "application/json" },
        },
      ]),
      { fetch: fetchMock },
    );
    const task = await adapter.submit({
      connectionId: "openai",
      operation: "image.edit",
      prompt: "Turn it into stained glass",
      idempotencyKey: "idem-2",
      assets: [
        {
          id: "asset-1",
          kind: "image",
          mimeType: "image/png",
          filename: "source.png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    expect(await adapter.extractOutputs(task.result)).toEqual([
      {
        kind: "image",
        url: "https://output.test/edit.png",
        mimeType: "image/png",
        filename: "openai-1.png",
      },
    ]);
  });

  it("rejects unsupported assets and invalid paid-request parameters before fetch", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        { id: "openai", provider: "openai", apiKey: "sk-test" },
      ]),
      { fetch: fetchMock },
    );
    const invalidRequest = {
      connectionId: "openai",
      operation: "image.edit" as const,
      prompt: "Edit this",
      idempotencyKey: "invalid-edit",
      assets: [
        {
          id: "video",
          kind: "video" as const,
          mimeType: "video/mp4",
          url: "https://assets.test/input.mp4",
        },
        {
          id: "bad-image",
          kind: "image" as const,
          mimeType: "image/gif",
          data: new Uint8Array(),
        },
      ],
      parameters: {
        n: 0,
        output_compression: 101,
        output_format: "gif",
        size: "",
      },
    };

    const validation = await adapter.validate(invalidRequest);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unsupported_asset_kind",
        "unsupported_mime_type",
        "unresolved_asset",
        "invalid_count",
        "invalid_output_compression",
        "invalid_output_format",
        "invalid_parameter",
      ]),
    );
    await expect(adapter.submit(invalidRequest)).rejects.toThrow(
      "Provider request is invalid",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the reference image count", async () => {
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        { id: "openai", provider: "openai", apiKey: "sk-test" },
      ]),
    );
    const validation = await adapter.validate({
      connectionId: "openai",
      operation: "image.edit",
      prompt: "Combine references",
      idempotencyKey: "too-many",
      assets: Array.from({ length: 17 }, (_, index) => ({
        id: `image-${index}`,
        kind: "image" as const,
        mimeType: "image/png",
        data: new Uint8Array([1]),
      })),
    });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "too_many_images" }),
      ]),
    );
  });

  it("enforces current gpt-image-2 output constraints before submit", async () => {
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        { id: "openai", provider: "openai", apiKey: "sk-test" },
      ]),
    );
    const validation = await adapter.validate({
      connectionId: "openai",
      operation: "image.generate",
      prompt: "A glass observatory",
      idempotencyKey: "invalid-gpt-image-2-options",
      parameters: {
        size: "1000x1000",
        quality: "ultra",
        background: "transparent",
        moderation: "strict",
        output_compression: 50,
        output_format: "png",
      },
    });
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid_size",
        "invalid_quality",
        "unsupported_background",
        "invalid_moderation",
      ]),
    );
  });
});
