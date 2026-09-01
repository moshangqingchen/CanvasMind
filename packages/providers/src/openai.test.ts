import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials";
import { OpenAIImageAdapter, WeAIImageAdapter } from "./openai";

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

  it("uses FriModel's live keyed inventory as the image-model source of truth", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "gpt-image-2" },
          { id: "nano-banana-pro" },
          { id: "gpt-5.6" },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "frimodel",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.frimodel.com/v1",
          settings: {
            supplierKey: "frimodel",
            defaultModel: "removed-image-model",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const models = await adapter.listModels("frimodel");
    expect(models.map((model) => model.id)).toEqual([
      "gpt-image-2",
      "nano-banana-pro",
    ]);
    expect(models.some((model) => model.id === "removed-image-model")).toBe(
      false,
    );
  });

  it("only exposes the documented GPT Image 2 models as editable", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "nano-banana-pro" }, { id: "gpt-image-2-adobe" }],
      }),
    ) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "frimodel-edit-capability",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.frimodel.com/v1",
          settings: {
            supplierKey: "frimodel",
            defaultModel: "gpt-image-2-adobe",
          },
        },
      ]),
      { fetch: fetchMock },
    );
    const models = await adapter.listModels("frimodel-edit-capability");
    expect(models.find((model) => model.id === "gpt-image-2-adobe")).toMatchObject(
      {
        operations: ["image.generate", "image.edit"],
        inputKinds: ["text", "image"],
        metadata: {
          supportsImageEdit: true,
          referenceEditEndpoint: "/v1/images/edits",
        },
      },
    );
    expect(models.find((model) => model.id === "nano-banana-pro")).toMatchObject(
      {
        operations: ["image.generate"],
        inputKinds: ["text"],
        metadata: { supportsImageEdit: false },
      },
    );
    await expect(
      adapter.validate({
        connectionId: "frimodel-edit-capability",
        operation: "image.edit",
        model: "nano-banana-pro",
        prompt: "Edit this image",
        idempotencyKey: "frimodel-unsupported-edit",
        assets: [
          {
            id: "reference",
            kind: "image",
            mimeType: "image/png",
            data: new Uint8Array([137, 80, 78, 71]),
          },
        ],
      }),
    ).resolves.toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported_operation",
          message: expect.stringContaining("/v1/images/edits"),
        }),
      ]),
    });
  });

  it("uses FriModel's documented Images API image protocol", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/models"))
        return jsonResponse({ data: [{ id: "gpt-image-2-adobe" }] });
      if (url.endsWith("/images/generations"))
        return jsonResponse({
          data: [{ url: "https://cdn.frimodel.test/generated.png" }],
        });
      throw new Error(`unexpected FriModel endpoint: ${url}`);
    }) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "frimodel",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.frimodel.com/v1",
          settings: {
            supplierKey: "frimodel",
            modelGroup: "gpt_image_adobe",
            defaultModel: "gpt-image-2-adobe",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const task = await adapter.submit({
      connectionId: "frimodel",
      operation: "image.generate",
      prompt: "A glossy red apple on a white table",
      idempotencyKey: "frimodel-images",
      parameters: {
        size: "3840x2160",
        quality: "high",
        n: 1,
        output_format: "png",
      },
    });
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);
    timeoutSpy.mockRestore();

    const listed = await adapter.listModels("frimodel");
    expect(listed[0]).toMatchObject({
      id: "gpt-image-2-adobe",
      operations: ["image.generate", "image.edit"],
      metadata: {
        protocol: "frimodel-images",
        liveInventory: true,
        fixedOutputCount: 1,
      },
    });
    expect(listed[0]?.parameters?.map((parameter) => parameter.key)).toEqual([
      "size",
      "quality",
      "background",
      "output_format",
    ]);
    const sizeParameter = listed[0]?.parameters?.find(
      (parameter) => parameter.key === "size",
    );
    expect(sizeParameter).toMatchObject({
      control: "dimensions",
      default: "auto",
      min: 16,
      max: 3840,
      step: 16,
    });
    expect(sizeParameter?.options?.[0]).toEqual({
      label: "自动（提示词优先，其次参考图）",
      value: "auto",
    });
    expect(sizeParameter?.options).toEqual(
      expect.arrayContaining([
        { label: "4K · 16:9 · 3840 × 2160", value: "3840x2160" },
      ]),
    );
    const qualityParameter = listed[0]?.parameters?.find(
      (parameter) => parameter.key === "quality",
    );
    expect(qualityParameter?.default).toBe("high");
    expect(qualityParameter?.options).toEqual(
      expect.arrayContaining([{ label: "高（high）", value: "high" }]),
    );
    expect(qualityParameter?.options).not.toEqual(
      expect.arrayContaining([{ value: "hd" }]),
    );

    const imageCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/generations"));
    expect(String(imageCall?.[0])).toBe(
      "https://api.frimodel.com/v1/images/generations",
    );
    expect(JSON.parse(String(imageCall?.[1]?.body))).toEqual({
      model: "gpt-image-2-adobe",
      prompt: "A glossy red apple on a white table",
      size: "3840x2160",
      quality: "high",
      output_format: "png",
    });

    await expect(
      adapter.validate({
        connectionId: "frimodel",
        operation: "image.generate",
        model: "gpt-image-2-adobe",
        prompt: "Two variants",
        idempotencyKey: "frimodel-batch-rejected",
        parameters: { n: 2 },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "invalid_count",
            message: "FriModel 图片接口单次仅支持生成 1 张",
          }),
        ]),
      }),
    );

    vi.mocked(fetchMock).mockClear();
    await adapter.submit({
      connectionId: "frimodel",
      operation: "image.generate",
      model: "gpt-image-2-adobe",
      prompt: "A 4K square product image",
      idempotencyKey: "frimodel-4k-shortcut",
      parameters: { size: "auto", size_tier: "4K", quality: "high" },
    });
    const tierBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body),
    );
    expect(tierBody).toMatchObject({
      model: "gpt-image-2-adobe",
      size: "2880x2880",
      quality: "high",
    });
    expect(task.result).toMatchObject({
      protocol: "frimodel-images",
    });
    await expect(adapter.extractOutputs(task.result)).resolves.toEqual([
      {
        kind: "image",
        url: "https://cdn.frimodel.test/generated.png",
        mimeType: "image/png",
        filename: "openai-1.png",
      },
    ]);
  });

  it("keeps FriModel's gpt-image-2-high model on fixed high quality", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/models"))
        return jsonResponse({ data: [{ id: "gpt-image-2-high" }] });
      if (url.endsWith("/images/generations"))
        return jsonResponse({
          data: [{ url: "https://cdn.frimodel.test/fixed-high.png" }],
        });
      throw new Error(`unexpected FriModel endpoint: ${url}`);
    }) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "frimodel-high",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.frimodel.com/v1",
          settings: {
            supplierKey: "frimodel",
            modelGroup: "gpt_image_adobe",
            defaultModel: "gpt-image-2-high",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const listed = await adapter.listModels("frimodel-high");
    const quality = listed[0]?.parameters?.find(
      (parameter) => parameter.key === "quality",
    );
    expect(quality).toMatchObject({
      default: "high",
      options: [{ label: "高（high，模型固定）", value: "high" }],
    });

    await adapter.submit({
      connectionId: "frimodel-high",
      operation: "image.generate",
      model: "gpt-image-2-high",
      prompt: "A blue ceramic vase",
      idempotencyKey: "frimodel-fixed-high",
      parameters: { size: "2880x2880", quality: "standard" },
    });
    const imageCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/generations"));
    expect(JSON.parse(String(imageCall?.[1]?.body))).toMatchObject({
      model: "gpt-image-2-high",
      size: "2880x2880",
      quality: "high",
    });
  });

  it("uses FriModel's multipart Images edit route when a reference image is present", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/images/edits"))
        return jsonResponse({
          data: [{ b64_json: Buffer.from("edited-image").toString("base64") }],
        });
      throw new Error(`unexpected FriModel endpoint: ${url}`);
    }) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "frimodel-edit",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.frimodel.com/v1",
          settings: {
            supplierKey: "frimodel",
            defaultModel: "gpt-image-2-adobe",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "frimodel-edit",
      operation: "image.edit",
      prompt: "Keep the subject, replace the background with a blue sky",
      idempotencyKey: "frimodel-edit",
      parameters: { size: "1024x1024", quality: "high", output_format: "png" },
      assets: [
        {
          id: "reference-1",
          kind: "image",
          mimeType: "image/png",
          filename: "reference.png",
          data: new Uint8Array([137, 80, 78, 71]),
        },
      ],
    });

    const editCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/edits"));
    expect(String(editCall?.[0])).toBe(
      "https://api.frimodel.com/v1/images/edits",
    );
    const form = editCall?.[1]?.body;
    expect(form).toBeInstanceOf(FormData);
    expect(new Headers(editCall?.[1]?.headers).get("content-type")).toBeNull();
    const fields = form instanceof FormData ? form : undefined;
    expect(fields?.get("model")).toBe("gpt-image-2-adobe");
    expect(fields?.get("prompt")).toBe(
      "Keep the subject, replace the background with a blue sky",
    );
    expect(fields?.get("size")).toBe("1024x1024");
    expect(fields?.get("quality")).toBe("high");
    expect(fields?.get("output_format")).toBe("png");
    expect(fields?.get("image")).toBeInstanceOf(File);
    expect(task.result).toMatchObject({ protocol: "frimodel-images" });
    const outputs = await adapter.extractOutputs(task.result);
    expect(Buffer.from(outputs[0]?.data ?? []).toString()).toBe("edited-image");
  });

  it("extracts FriModel image_url objects and b64_json responses", async () => {
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "frimodel",
          provider: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.frimodel.com/v1",
          settings: { supplierKey: "frimodel" },
        },
      ]),
    );
    const base64 = Buffer.from("short-image-bytes").toString("base64");
    const outputs = await adapter.extractOutputs({
      protocol: "frimodel-chat-completions",
      outputFormat: "png",
      response: {
        choices: [
          {
            message: {
              content: [
                {
                  type: "image_url",
                  image_url: { url: "https://cdn.frimodel.test/object.webp" },
                },
                { b64_json: base64, mime_type: "image/jpeg" },
              ],
            },
          },
        ],
      },
    });
    expect(outputs).toEqual([
      {
        kind: "image",
        url: "https://cdn.frimodel.test/object.webp",
        mimeType: "image/webp",
        filename: "openai-1.webp",
      },
      {
        kind: "image",
        data: new Uint8Array(Buffer.from("short-image-bytes")),
        mimeType: "image/jpeg",
        filename: "openai-2.jpeg",
      },
    ]);
  });

  it("uses 辰途's live keyed inventory and documented Images parameters", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) {
        return jsonResponse({
          data: [
            { id: "gpt-image-2-4k" },
            { id: "gpt-image-2自由传参" },
            { id: "gemini-3.1-flash-image-2k" },
            { id: "gpt-5.4" },
          ],
        });
      }
      return jsonResponse({
        data: [{ url: "https://tu.988236.xyz/generated/result.png" }],
      });
    }) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "chentu",
          provider: "openai",
          apiKey: "sk-chentu",
          baseUrl: "https://tu.988236.xyz/v1",
          settings: {
            supplierKey: "chentu",
            defaultModel: "removed-image-model",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const models = await adapter.listModels("chentu");
    expect(models.map((model) => model.id)).toEqual([
      "gemini-3.1-flash-image-2k",
      "gpt-image-2-4k",
      "gpt-image-2自由传参",
    ]);
    expect(
      models.find((model) => model.id === "gpt-image-2-4k")?.parameters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "size",
          options: expect.arrayContaining([
            expect.objectContaining({ value: "3840x2160" }),
            expect.objectContaining({
              label: "4K · 16:9 · 3840 × 2160",
              value: "3840x2160",
            }),
          ]),
        }),
        expect.objectContaining({ key: "response_format", default: "url" }),
        expect.objectContaining({
          key: "quality",
          options: expect.arrayContaining([
            expect.objectContaining({ value: "high" }),
          ]),
        }),
      ]),
    );
    expect(
      models
        .find((model) => model.id === "gemini-3.1-flash-image-2k")
        ?.parameters?.some((parameter) => parameter.key === "quality"),
    ).toBe(false);
    expect(models.find((model) => model.id === "gpt-image-2-4k")?.name).toBe(
      "GPT Image 2 · 4k（￥ 0.05 / 请求）",
    );
    const freeModel = models.find(
      (model) => model.id === "gpt-image-2自由传参",
    );
    expect(freeModel?.name).toBe("GPT Image 2 · 自由传参（￥ 0.05 / 请求）");
    expect(
      freeModel?.parameters?.find((parameter) => parameter.key === "size"),
    ).toMatchObject({
      control: "dimensions",
      label: "输出分辨率（size）",
      default: "auto",
      min: 16,
      max: 8192,
      step: 16,
    });
    const freeSize = freeModel?.parameters?.find(
      (parameter) => parameter.key === "size",
    );
    expect(freeSize?.description).toContain("提示词中的比例");
    expect(freeSize?.options?.[0]).toMatchObject({
      label: "自动（提示词优先，其次参考图）",
      value: "auto",
    });
    expect(freeSize?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringMatching(/^1K\b/u),
          value: "1024x1024",
        }),
        expect.objectContaining({
          label: expect.stringMatching(/^2K\b/u),
          value: "2048x2048",
        }),
        expect.objectContaining({
          label: expect.stringMatching(/^4K\b/u),
          value: "3840x2160",
        }),
        expect.objectContaining({
          label: expect.stringMatching(/^4K\b/u),
          value: "2480x3312",
        }),
      ]),
    );

    const task = await adapter.submit({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2-4k",
      prompt: "A bright future city, no text",
      idempotencyKey: "chentu-image-1",
      parameters: {
        size: "3840x2160",
        quality: "high",
        output_format: "png",
      },
    });
    const generationCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/generations"));
    expect(String(generationCall?.[0])).toBe(
      "https://tu.988236.xyz/v1/images/generations",
    );
    expect(new Headers(generationCall?.[1]?.headers).get("authorization")).toBe(
      "Bearer sk-chentu",
    );
    expect(JSON.parse(String(generationCall?.[1]?.body))).toMatchObject({
      model: "gpt-image-2-4k",
      size: "3840x2160",
      quality: "high",
      response_format: "url",
    });

    vi.mocked(fetchMock).mockClear();
    await adapter.submit({
      connectionId: "chentu",
      operation: "image.edit",
      model: "gpt-image-2自由传参",
      prompt: "保留主体并替换背景",
      idempotencyKey: "chentu-image-edit-url",
      parameters: {
        size: "3840x2160",
        quality: "high",
        response_format: "url",
      },
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          url: "https://canvas.example/reference.png",
        },
      ],
    });
    const editCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/edits"));
    expect(editCall?.[1]?.body).toBeInstanceOf(FormData);
    const editForm = editCall?.[1]?.body as FormData;
    expect(editForm.get("image_url")).toBe(
      "https://canvas.example/reference.png",
    );
    expect(editForm.get("image")).toBeNull();

    vi.mocked(fetchMock).mockClear();
    await adapter.submit({
      connectionId: "chentu",
      operation: "image.edit",
      model: "gpt-image-2自由传参",
      prompt: "保留主体并换成白色背景",
      idempotencyKey: "chentu-image-edit-bytes",
      parameters: {
        size: "3840x2160",
        quality: "high",
        response_format: "url",
      },
      assets: [
        {
          id: "reference-with-bytes",
          kind: "image",
          mimeType: "image/png",
          // Runtime assets normally contain bytes and may also carry a
          // signed URL. Chentu must receive the multipart file in this case.
          data: new Uint8Array([137, 80, 78, 71]),
          url: "https://canvas.example/reference.png",
        },
      ],
    });
    const bytesEditCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/edits"));
    const bytesEditForm = bytesEditCall?.[1]?.body as FormData;
    expect(bytesEditForm.get("image")).toBeInstanceOf(File);
    expect(bytesEditForm.get("image_url")).toBeNull();

    const officialAdapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "chentu-official",
          provider: "openai",
          apiKey: "sk-official",
          baseUrl: "https://tu.988236.xyz/v1",
          settings: {
            supplierKey: "chentu",
            modelGroup: "image2官key",
          },
        },
      ]),
      { fetch: fetchMock },
    );
    const officialModels = await officialAdapter.listModels("chentu-official");
    const officialModel = officialModels.find((model) => model.id === "gpt-image-2-4k");
    expect(officialModel?.name).toBe("GPT Image 2 · 4k（￥ 0.18 / 请求）");
    const officialStyle = officialModel?.parameters?.find((p) => p.key === "style");
    const officialQuality = officialModel?.parameters?.find((p) => p.key === "quality");
    const officialCount = officialModel?.parameters?.find((p) => p.key === "n");
    expect(officialStyle).toMatchObject({ key: "style", default: "vivid" });
    expect(officialQuality?.default).toBe("standard");
    expect(officialQuality?.options?.some((option) => option.value === "standard")).toBe(true);
    expect(officialCount?.max).toBe(10);
    expect(officialModel?.operations).toEqual(["image.generate", "image.edit"]);
    const officialEditValidation = await officialAdapter.validate({
      connectionId: "chentu-official",
      operation: "image.edit",
      model: "gpt-image-2-4k",
      prompt: "Edit this image",
      idempotencyKey: "chentu-official-edit",
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array([137, 80, 78, 71]),
        },
      ],
      parameters: { style: "natural" },
    });
    expect(officialEditValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_style" }),
      ]),
    );
    vi.mocked(fetchMock).mockClear();
    await officialAdapter.submit({
      connectionId: "chentu-official",
      operation: "image.generate",
      model: "gpt-image-2-4k",
      prompt: "A clean geometric poster",
      idempotencyKey: "chentu-official-defaults",
    });
    const officialBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body),
    );
    expect(officialBody).toMatchObject({
      model: "gpt-image-2-4k",
      style: "vivid",
      n: 1,
      response_format: "url",
    });
    expect(officialBody).not.toHaveProperty("quality");
    expect(await adapter.extractOutputs(task.result)).toEqual([
      {
        kind: "image",
        url: "https://tu.988236.xyz/generated/result.png",
        mimeType: "image/png",
        filename: "openai-1.png",
      },
    ]);

    vi.mocked(fetchMock).mockClear();
    const freeTask = await adapter.submit({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2自由传参",
      prompt: "A tall blue geometric poster, no text",
      idempotencyKey: "chentu-free-custom",
      parameters: { size: "3360x4480", quality: "high" },
    });
    const freeBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body),
    );
    expect(freeBody).toMatchObject({
      model: "gpt-image-2自由传参",
      size: "3360x4480",
      quality: "high",
      response_format: "url",
    });
    expect(await adapter.extractOutputs(freeTask.result)).toEqual([
      {
        kind: "image",
        url: "https://tu.988236.xyz/generated/result.png",
        mimeType: "image/png",
        filename: "openai-1.png",
      },
    ]);

    vi.mocked(fetchMock).mockClear();
    await adapter.submit({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2自由传参",
      prompt: "A 3:4 portrait poster, no text",
      idempotencyKey: "chentu-free-4k-tier",
      parameters: {
        size: "auto",
        size_tier: "4K",
        aspect_ratio: "3:4",
        quality: "high",
      },
    });
    const freeTierBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body),
    );
    expect(freeTierBody).toMatchObject({
      model: "gpt-image-2自由传参",
      size: "2480x3312",
      quality: "high",
      response_format: "url",
    });

    vi.mocked(fetchMock).mockClear();
    await adapter.submit({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2自由传参",
      prompt: "A square product photo, no text",
      idempotencyKey: "chentu-free-auto",
      parameters: { size: "auto", quality: "high" },
    });
    const freeAutoBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body),
    );
    expect(freeAutoBody).toMatchObject({
      model: "gpt-image-2自由传参",
      quality: "high",
      response_format: "url",
    });
    expect(freeAutoBody).not.toHaveProperty("size");

    vi.mocked(fetchMock).mockClear();
    await adapter.submit({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2-4k",
      prompt: "Default URL response",
      idempotencyKey: "chentu-default-url",
    });
    expect(
      JSON.parse(String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body)),
    ).toMatchObject({ response_format: "url" });

    vi.mocked(fetchMock).mockClear();
    const legacyQualityTask = await adapter.submit({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2-1k",
      prompt: "A square product image",
      idempotencyKey: "chentu-legacy-quality-tier",
      parameters: { size: "1024x1024", quality: " 4K " },
    });
    const legacyQualityBody = JSON.parse(
      String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body),
    );
    expect(legacyQualityBody).toMatchObject({
      model: "gpt-image-2-1k",
      size: "1024x1024",
      response_format: "url",
    });
    expect(legacyQualityBody).not.toHaveProperty("quality");
    expect(await adapter.extractOutputs(legacyQualityTask.result)).toHaveLength(1);

    const legacyQualityValidation = await adapter.validate({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2-1k",
      prompt: "A square product image",
      idempotencyKey: "chentu-legacy-quality-tier-validation",
      parameters: { size: "1024x1024", quality: "4K" },
    });
    expect(legacyQualityValidation.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid_quality" })]),
    );

    const invalid = await adapter.validate({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gemini-3.1-flash-image-2k",
      prompt: "An unsupported size",
      idempotencyKey: "chentu-invalid-size",
      parameters: { size: "1920x1080" },
    });
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_image_size" }),
      ]),
    );
    const freeValid = await adapter.validate({
      connectionId: "chentu",
      operation: "image.generate",
      model: "gpt-image-2自由传参",
      prompt: "Custom size",
      idempotencyKey: "chentu-free-valid",
      parameters: { size: "3360x4480", quality: "high" },
    });
    expect(freeValid.issues).toEqual([]);
  });

  it("accepts a 辰途 Base64 response larger than the URL envelope limit", async () => {
    const largeBase64 = Buffer.alloc(9 * 1024 * 1024, 7).toString("base64");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/images/generations"))
        return jsonResponse({ data: [{ b64_json: largeBase64 }] });
      throw new Error(`unexpected 辰途 endpoint: ${String(input)}`);
    }) as unknown as typeof fetch;
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "chentu-large-base64",
          provider: "openai",
          apiKey: "sk-chentu",
          baseUrl: "https://tu.988236.xyz/v1",
          settings: { supplierKey: "chentu" },
        },
      ]),
      { fetch: fetchMock },
    );

    await expect(
      adapter.submit({
        connectionId: "chentu-large-base64",
        operation: "image.generate",
        model: "gpt-image-2-4k",
        prompt: "A 4K test image",
        idempotencyKey: "chentu-large-base64",
        parameters: { size: "3840x2160", response_format: "url" },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
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

describe("WeAIImageAdapter", () => {
  it("uses the Asian We-AI v1 route, filters incompatible fields, and decodes data URLs", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            b64_json: `data:image/png;base64,${Buffer.from("weai-image").toString("base64")}`,
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai",
          provider: "weai",
          apiKey: "sk-weai",
          baseUrl: "https://asian-acc.we-token.cc",
        },
      ]),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "weai",
      operation: "image.generate",
      prompt: "A glass pavilion",
      idempotencyKey: "weai-generate",
      parameters: {
        aspect_ratio: "16:9",
        n: 1,
        quality: "high",
        output_format: "webp",
        output_compression: 70,
      },
    });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://asian-acc.we-token.cc/v1/images/generations",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-image-2",
      prompt: "A glass pavilion",
      n: 1,
      size: "1360x768",
    });
    expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
    expect(task.providerTaskId).toBe("weai:weai-generate");
    const outputs = await adapter.extractOutputs(task.result);
    expect(Buffer.from(outputs[0]?.data ?? []).toString()).toBe("weai-image");
    expect(outputs[0]).toMatchObject({
      mimeType: "image/png",
      filename: "weai-1.png",
    });
  });

  it("uses only Adobe per-request suffix models and sends only compatible fields", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            b64_json: Buffer.from("weai-size-output").toString("base64"),
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-adobe-per-request",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-按次",
            defaultModel: "gpt-image-2-high",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "weai-adobe-per-request",
      operation: "image.generate",
      model: "gpt-image-2-high",
      prompt: "A wide product photograph",
      idempotencyKey: "weai-4k-generate",
      parameters: {
        n: 1,
        quality: "low",
        output_format: "webp",
        output_compression: 70,
        size: "3840x2160",
      },
    });
    await adapter.submit({
      connectionId: "weai-adobe-per-request",
      operation: "image.edit",
      model: "gpt-image-2-high",
      prompt: "Keep the subject and make the composition vertical",
      idempotencyKey: "weai-4k-edit",
      parameters: {
        n: 1,
        quality: "medium",
        output_format: "webp",
        output_compression: 60,
        size: "2160x3840",
      },
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    const [generateUrl, generateInit] =
      vi.mocked(fetchMock).mock.calls[0] ?? [];
    expect(String(generateUrl)).toBe(
      "https://asian-acc.we-token.cc/v1/images/generations",
    );
    const generateBody = JSON.parse(String(generateInit?.body));
    expect(generateBody).toEqual({
      model: "gpt-image-2-high",
      prompt: "A wide product photograph",
      n: 1,
      size: "3840x2160",
      response_format: "url",
    });
    expect(generateBody).not.toHaveProperty("quality");
    expect(generateBody).not.toHaveProperty("output_format");
    expect(generateBody).not.toHaveProperty("output_compression");

    const [editUrl, editInit] = vi.mocked(fetchMock).mock.calls[1] ?? [];
    expect(String(editUrl)).toBe(
      "https://asian-acc.we-token.cc/v1/images/edits",
    );
    expect(editInit?.body).toBeInstanceOf(FormData);
    const editForm = editInit?.body as FormData;
    expect(editForm.get("prompt")).toBe(
      "Keep the subject and make the composition vertical",
    );
    expect(editForm.get("size")).toBe("2160x3840");
    expect(editForm.get("size")).not.toBe("4K");
    expect(editForm.get("response_format")).toBe("url");
    expect(editForm.has("quality")).toBe(false);
    expect(editForm.has("output_format")).toBe(false);
    expect(editForm.has("output_compression")).toBe(false);

    const plainModel = await adapter.validate({
      connectionId: "weai-adobe-per-request",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "An invalid Adobe request",
      idempotencyKey: "weai-adobe-plain-model",
    });
    expect(plainModel.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "model_group_mismatch",
          path: "model",
        }),
      ]),
    );
  });

  it("rejects fabricated Adobe resolution model IDs and validates exact pixel sizes", async () => {
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-adobe-exact-models",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-按次",
            defaultModel: "gpt-image-2-low",
          },
        },
      ]),
    );

    for (const syntheticModel of [
      "gpt-image-2::1k",
      "gpt-image-2::2k",
      "gpt-image-2::4k",
    ]) {
      const validation = await adapter.validate({
        connectionId: "weai-adobe-exact-models",
        operation: "image.generate",
        model: syntheticModel,
        prompt: "Reject a fabricated model identifier",
        idempotencyKey: `reject-${syntheticModel}`,
      });
      expect(validation.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "model_group_mismatch" }),
        ]),
      );
    }

    for (const size of [
      "1024x1024",
      "2048x2048",
      "2048x1152",
      "2160x2160",
      "3840x2160",
      "2160x3840",
      "2880x2160",
      "2160x2880",
      "3264x2176",
      "2176x3264",
      "3840x1648",
    ]) {
      const validation = await adapter.validate({
        connectionId: "weai-adobe-exact-models",
        operation: "image.generate",
        model: "gpt-image-2-high",
        prompt: "Validate an exact pixel size",
        idempotencyKey: `weai-adobe-exact-${size}`,
        parameters: { size },
      });
      expect(validation.issues).toEqual([]);
    }

    for (const legacySize of ["3240x2160", "2160x3240"]) {
      const validation = await adapter.validate({
        connectionId: "weai-adobe-exact-models",
        operation: "image.generate",
        model: "gpt-image-2-high",
        prompt: "Reject a legacy non-aligned 4K preset",
        idempotencyKey: `weai-adobe-invalid-4k-${legacySize}`,
        parameters: { size: legacySize },
      });
      expect(validation.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "invalid_size" }),
        ]),
      );
    }
  });

  it("allows URL output on Adobe fixed-quality models", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ url: "https://cdn.test/weai-adobe-fixed-quality.png" }],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-adobe-fixed-quality-url",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-按次",
            defaultModel: "gpt-image-2-high",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "weai-adobe-fixed-quality-url",
      operation: "image.generate",
      model: "gpt-image-2-high",
      prompt: "A minimal product icon",
      idempotencyKey: "weai-adobe-fixed-quality-url",
      parameters: {
        n: 1,
        size: "1024x1024",
        response_format: "url",
      },
    });

    expect(
      JSON.parse(String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body)),
    ).toEqual({
      model: "gpt-image-2-high",
      prompt: "A minimal product icon",
      n: 1,
      size: "1024x1024",
      response_format: "url",
    });
    expect(await adapter.extractOutputs(task.result)).toEqual([
      {
        kind: "image",
        url: "https://cdn.test/weai-adobe-fixed-quality.png",
        mimeType: "image/png",
        filename: "weai-1.png",
      },
    ]);

    const invalidResponseFormat = await adapter.validate({
      connectionId: "weai-adobe-fixed-quality-url",
      operation: "image.generate",
      model: "gpt-image-2-high",
      prompt: "Reject unsupported response format",
      idempotencyKey: "weai-adobe-fixed-quality-invalid-response-format",
      parameters: { response_format: "b64_json" },
    });
    expect(invalidResponseFormat.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "parameters.response_format",
          code: "invalid_response_format",
        }),
      ]),
    );
  });

  it("keeps the Adobe URL-return group independent and requests URL output", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models"))
        return jsonResponse({
          data: [{ id: "gpt-image-2" }, { id: "gpt-image-2-high" }],
        });
      return jsonResponse({
        data: [{ url: "https://cdn.test/weai-result.png" }],
      });
    }) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-adobe-url",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-按次-返回url",
            defaultModel: "gpt-image-2",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const models = await adapter.listModels("weai-adobe-url");
    expect(models.map((model) => model.id)).toEqual(["gpt-image-2"]);
    expect(models[0]?.name).toBe(
      "GPT Image 2（LOW $0.04/次 · MEDIUM $0.07/次 · HIGH $0.15/次 · 1K/2K/4K · 返回 URL）",
    );
    expect(
      models[0]?.parameters?.find((parameter) => parameter.key === "quality"),
    ).toMatchObject({ label: "质量（quality，可选）" });
    expect(
      models[0]?.parameters?.find((parameter) => parameter.key === "n")?.max,
    ).toBe(10);

    const task = await adapter.submit({
      connectionId: "weai-adobe-url",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "A polished product hero image",
      idempotencyKey: "weai-adobe-url-generate",
      parameters: {
        n: 2,
        quality: "medium",
        size: "2048x1152",
        output_format: "webp",
      },
    });

    const generationCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([url]) => String(url).endsWith("/images/generations"));
    expect(JSON.parse(String(generationCall?.[1]?.body))).toEqual({
      model: "gpt-image-2",
      prompt: "A polished product hero image",
      n: 2,
      quality: "medium",
      size: "2048x1152",
      response_format: "url",
    });
    expect(await adapter.extractOutputs(task.result)).toEqual([
      {
        kind: "image",
        url: "https://cdn.test/weai-result.png",
        mimeType: "image/png",
        filename: "weai-1.png",
      },
    ]);

    const suffixModel = await adapter.validate({
      connectionId: "weai-adobe-url",
      operation: "image.generate",
      model: "gpt-image-2-high",
      prompt: "Wrong group model",
      idempotencyKey: "weai-adobe-url-wrong-model",
    });
    expect(suffixModel.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "model_group_mismatch" }),
      ]),
    );
  });

  it("exposes group prices, multipliers, K presets, and output-count limits", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "gpt-image-1" },
          { id: "gpt-image-1.5" },
          { id: "gpt-image-2" },
          { id: "gpt-image-2-low" },
          { id: "gpt-image-2-medium" },
          { id: "gpt-image-2-high" },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-codex",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-codex-token计费",
            defaultModel: "gpt-image-2",
          },
        },
        {
          id: "weai-adobe-token",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-token计费",
            defaultModel: "gpt-image-2",
          },
        },
        {
          id: "weai-adobe-per-request",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-按次",
            defaultModel: "gpt-image-2-high",
          },
        },
        {
          id: "weai-azure",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "AZURE-openai",
            defaultModel: "gpt-image-2",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const codexModels = await adapter.listModels("weai-codex");
    const adobeTokenModels = await adapter.listModels("weai-adobe-token");
    const adobeModels = await adapter.listModels("weai-adobe-per-request");
    const azureModels = await adapter.listModels("weai-azure");
    const codexModel = codexModels.find((model) => model.id === "gpt-image-2");
    const adobeModel = adobeModels.find(
      (model) => model.id === "gpt-image-2-high",
    );
    const adobeTokenModel = adobeTokenModels.find(
      (model) => model.id === "gpt-image-2",
    );
    const azureGptImage2 = azureModels.find(
      (model) => model.id === "gpt-image-2",
    );
    const codexCount = codexModel?.parameters?.find(
      (parameter) => parameter.key === "n",
    );
    const adobeCount = adobeModel?.parameters?.find(
      (parameter) => parameter.key === "n",
    );
    const adobeSize = adobeModel?.parameters?.find(
      (parameter) => parameter.key === "size",
    );
    const adobeQuality = adobeModel?.parameters?.find(
      (parameter) => parameter.key === "quality",
    );
    const tokenQuality = adobeTokenModel?.parameters?.find(
      (parameter) => parameter.key === "quality",
    );
    const azureQuality = azureGptImage2?.parameters?.find(
      (parameter) => parameter.key === "quality",
    );

    expect(codexModels.map((model) => model.id)).toEqual(["gpt-image-2"]);
    expect(adobeTokenModels.map((model) => model.id)).toEqual(["gpt-image-2"]);
    expect(adobeModels.map((model) => model.id)).toEqual([
      "gpt-image-2-low",
      "gpt-image-2-medium",
      "gpt-image-2-high",
    ]);
    expect(azureModels.map((model) => model.id)).toEqual(["gpt-image-2"]);
    expect(codexModel?.name).toBe("GPT Image 2（0.7× Token · 1K/2K/4K）");
    expect(adobeModel?.name).toBe("GPT Image 2 HIGH（$0.15/次 · 1K/2K/4K）");
    expect(adobeModel?.metadata).toMatchObject({
      fixedQuality: "high",
    });
    expect(
      adobeModels.find((model) => model.id === "gpt-image-2-high")?.isDefault,
    ).toBe(true);
    expect(azureGptImage2?.name).toBe("GPT Image 2（3× Token · 1K/2K/4K）");
    expect(codexCount?.max).toBe(1);
    expect(adobeCount?.max).toBe(10);
    expect(adobeCount?.description).toContain("最多生成 10 张");
    expect(adobeSize).toMatchObject({
      label: "输出分辨率（size）",
      control: "dimensions",
      default: "auto",
    });
    expect(adobeSize?.options?.map((option) => option.value)).toEqual([
      "auto",
      "1024x1024",
      "1536x1024",
      "1024x1536",
      "2048x2048",
      "2048x1152",
      "2160x2160",
      "3840x2160",
      "2160x3840",
      "2880x2160",
      "2160x2880",
      "3264x2176",
      "2176x3264",
      "3840x1648",
    ]);
    expect(adobeQuality).toBeUndefined();
    expect(tokenQuality).toMatchObject({
      label: "质量（quality，可选）",
      options: [
        { value: "auto" },
        { value: "low" },
        { value: "medium" },
        { value: "high" },
      ],
    });
    expect(tokenQuality).toMatchObject({ default: "high" });
    expect(azureQuality).toMatchObject({ default: "high" });

    const invalidCodex = await adapter.validate({
      connectionId: "weai-codex",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "Two variants",
      idempotencyKey: "weai-codex-count",
      parameters: { n: 2 },
    });
    const validAdobe = await adapter.validate({
      connectionId: "weai-adobe-per-request",
      operation: "image.generate",
      model: "gpt-image-2-high",
      prompt: "Two variants",
      idempotencyKey: "weai-adobe-count",
      parameters: { n: 2 },
    });
    const validAzure = await adapter.validate({
      connectionId: "weai-azure",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "Two variants",
      idempotencyKey: "weai-azure-count",
      parameters: { n: 10 },
    });
    const invalidAzureBackground = await adapter.validate({
      connectionId: "weai-azure",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "Transparent product cutout",
      idempotencyKey: "weai-azure-transparent",
      parameters: { background: "transparent" },
    });
    expect(invalidCodex.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_count" }),
      ]),
    );
    expect(validAdobe.valid).toBe(true);
    expect(validAzure.valid).toBe(true);
    expect(invalidAzureBackground.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported_background" }),
      ]),
    );

    await adapter.submit({
      connectionId: "weai-adobe-token",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "Adobe token extensions",
      idempotencyKey: "weai-adobe-token-extensions",
      parameters: {
        n: 2,
        size: "2048x2048",
        quality: "high",
        output_format: "jpeg",
        output_compression: 80,
      },
    });
    await adapter.submit({
      connectionId: "weai-codex",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "Codex conservative fields",
      idempotencyKey: "weai-codex-fields",
      parameters: {
        n: 1,
        size: "1024x1024",
        quality: "high",
        output_format: "jpeg",
      },
    });
    const submitCalls = vi.mocked(fetchMock).mock.calls.slice(-2);
    expect(JSON.parse(String(submitCalls[0]?.[1]?.body))).toEqual({
      model: "gpt-image-2",
      prompt: "Adobe token extensions",
      n: 2,
      size: "2048x2048",
      quality: "high",
      output_format: "jpeg",
      output_compression: 80,
    });
    expect(JSON.parse(String(submitCalls[1]?.[1]?.body))).toEqual({
      model: "gpt-image-2",
      prompt: "Codex conservative fields",
      n: 1,
      size: "1024x1024",
    });
  });

  it("keeps the selected We-AI group from accepting another group model", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "gpt-image-1" },
          { id: "gpt-image-2" },
          { id: "gpt-image-2-high" },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-adobe-token",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-token计费",
            defaultModel: "gpt-image-2",
          },
        },
      ]),
      { fetch: fetchMock },
    );
    const models = await adapter.listModels("weai-adobe-token");
    expect(models.map((model) => model.id)).toEqual(["gpt-image-2"]);
    const validation = await adapter.validate({
      connectionId: "weai-adobe-token",
      operation: "image.generate",
      model: "gpt-image-2-high",
      prompt: "A test image",
      idempotencyKey: "weai-group-mismatch",
    });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "model_group_mismatch" }),
      ]),
    );
  });

  it("uses the live We-AI model scan as the source of availability", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "gpt-image-2-low" }, { id: "gpt-image-2-medium" }],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-adobe-live-scan",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-按次",
            defaultModel: "gpt-image-2-high",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const models = await adapter.listModels("weai-adobe-live-scan");
    expect(models.map((model) => model.id)).toEqual([
      "gpt-image-2-low",
      "gpt-image-2-medium",
    ]);
    expect(models.find((model) => model.isDefault)?.id).toBe("gpt-image-2-low");
  });

  it("hides a live model that the generation route rejected as unknown", async () => {
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-azure-quarantined",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "AZURE-openai",
            defaultModel: "gpt-image-2",
            unavailableModels: [
              {
                id: "gpt-image-2",
                reason: "unknown_model",
                detectedAt: "2026-08-03T03:55:23.531Z",
              },
            ],
          },
        },
      ]),
      {
        fetch: vi.fn(async () =>
          jsonResponse({ data: [{ id: "gpt-image-2" }] }),
        ),
      },
    );

    await expect(adapter.listModels("weai-azure-quarantined")).resolves.toEqual(
      [],
    );
    const validation = await adapter.validate({
      connectionId: "weai-azure-quarantined",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "A test image",
      idempotencyKey: "weai-azure-quarantined",
    });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "model_unavailable" }),
      ]),
    );
  });

  it("does not restore a static We-AI default when the live scan is empty", async () => {
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-empty-live-scan",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-codex-token计费",
            defaultModel: "gpt-image-2",
          },
        },
      ]),
      { fetch: vi.fn(async () => jsonResponse({ data: [] })) },
    );

    await expect(adapter.listModels("weai-empty-live-scan")).resolves.toEqual(
      [],
    );
  });

  it("scales the base64 JSON response allowance with a legal n=10 request", async () => {
    const declaredBytes = 70 * 1024 * 1024;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("output").toString("base64") }],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(declaredBytes),
            },
          },
        ),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-adobe-large-json",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-token计费",
            defaultModel: "gpt-image-2",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "weai-adobe-large-json",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "Ten image outputs",
      idempotencyKey: "weai-adobe-large-json-10",
      parameters: { n: 10, size: "1024x1024" },
    });

    expect(task.status).toBe("succeeded");
  });

  it("uses an available Adobe suffix model as the safe default without reviving an empty scan", async () => {
    const remoteFetch = vi.fn(async () =>
      jsonResponse({ data: [{ id: "gpt-image-2-high" }] }),
    ) as unknown as typeof fetch;
    const remoteAdapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-invalid-default",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-adobe-按次",
            defaultModel: "gpt-image-2",
          },
        },
      ]),
      { fetch: remoteFetch },
    );
    const remoteModels = await remoteAdapter.listModels("weai-invalid-default");
    expect(remoteModels.map((model) => model.id)).toEqual(["gpt-image-2-high"]);
    expect(
      remoteModels.filter((model) => model.isDefault).map((model) => model.id),
    ).toEqual(["gpt-image-2-high"]);
    expect(remoteModels[0]?.metadata).toMatchObject({ fixedQuality: "high" });
    expect(
      remoteModels[0]?.parameters?.some(
        (parameter) => parameter.key === "quality",
      ),
    ).toBe(false);

    const emptyFetch = vi.fn(async () =>
      jsonResponse({ data: [] }),
    ) as unknown as typeof fetch;
    const emptyAdapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-empty-models",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            modelGroup: "生图-openai-codex-token计费",
            defaultModel: "gpt-image-2",
          },
        },
      ]),
      { fetch: emptyFetch },
    );
    const emptyModels = await emptyAdapter.listModels("weai-empty-models");
    expect(emptyModels).toEqual([]);
  });

  it("uses Gemini generateContent for the banana group and extracts inline image data", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: "ignored explanation" },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: Buffer.from(jpeg).toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-gemini",
          provider: "weai",
          apiKey: "sk-weai",
          baseUrl: "https://asian-acc.we-token.cc/v1",
          settings: {
            config: {
              modelGroup: "gemini香蕉",
              defaultModel: "gemini-3.1-flash-image",
            },
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "weai-gemini",
      operation: "image.edit",
      prompt: "Turn this into a cinematic poster",
      idempotencyKey: "weai-gemini-edit",
      parameters: { n: 1, aspect_ratio: "16:9", image_size: "4k" },
      assets: [
        {
          id: "reference",
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://asian-acc.we-token.cc/v1beta/models/gemini-3.1-flash-image:generateContent",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-weai");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [
        {
          parts: [
            { text: "Turn this into a cinematic poster" },
            {
              inlineData: {
                mimeType: "image/png",
                data: Buffer.from([1, 2, 3]).toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
      },
    });
    expect(task.providerTaskId).toBe("weai:weai-gemini-edit");
    const outputs = await adapter.extractOutputs(task.result);
    expect(outputs).toEqual([
      {
        kind: "image",
        data: jpeg,
        mimeType: "image/jpeg",
        filename: "weai-1.jpeg",
      },
    ]);
  });

  it("uses MikotoPro Gemini native authentication and documented preview models", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from("mikoto-image").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "mikoto-gemini",
          provider: "weai",
          apiKey: "mikoto-secret",
          baseUrl: "https://api.mikoto.vip",
          settings: {
            supplierKey: "mikoto",
            modelGroup: "Gemini 原生图片",
            protocol: "gemini-generate-content",
            defaultModel: "gemini-3.1-flash-image-preview",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "mikoto-gemini",
      operation: "image.generate",
      model: "gemini-3.1-flash-image-preview",
      prompt: "A blue ceramic robot",
      idempotencyKey: "mikoto-gemini-1",
      parameters: { image_size: "4K", aspect_ratio: "16:9" },
    });
    const [url, init] = vi.mocked(fetchMock).mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.mikoto.vip/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("mikoto-secret");
    expect(headers.get("authorization")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [
        {
          role: "user",
          parts: [{ text: "A blue ceramic robot" }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { imageSize: "4K", aspectRatio: "16:9" },
      },
    });
    expect(task.status).toBe("succeeded");
    expect(await adapter.extractOutputs(task.result)).toMatchObject([
      { kind: "image", mimeType: "image/png" },
    ]);

    const models = await adapter.listModels("mikoto-gemini");
    expect(models.map((model) => model.name)).toEqual([
      "gemini-3.1-flash-image-preview（1K/2K/4K · $0.08/张）",
      "Gemini 3 Pro Image Preview（Pro 别名）（1K/2K/4K · $0.12/张）",
    ]);
    for (const model of models) {
      expect(model.limits?.maxInputImages).toBeUndefined();
      expect(
        model.parameters
          ?.find((parameter) => parameter.key === "image_size")
          ?.options?.map((option) => option.value),
      ).toEqual(["1K", "2K", "4K"]);
      expect(
        model.parameters
          ?.find((parameter) => parameter.key === "aspect_ratio")
          ?.options?.map((option) => option.value),
      ).toEqual(["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
    }

    const invalid = await adapter.validate({
      connectionId: "mikoto-gemini",
      operation: "image.generate",
      model: "gemini-3.1-flash-image-preview",
      prompt: "Invalid documented size",
      idempotencyKey: "mikoto-gemini-invalid-512",
      parameters: { image_size: "512", aspect_ratio: "21:9" },
    });
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_image_size" }),
        expect.objectContaining({ code: "invalid_aspect_ratio" }),
      ]),
    );
  });

  it("lets We-AI Gemini choose the output resolution from the prompt", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from([1, 2, 3]).toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-gemini-auto",
          provider: "weai",
          apiKey: "sk-weai",
          baseUrl: "https://asian-acc.we-token.cc/v1",
          settings: {
            config: {
              modelGroup: "gemini香蕉",
              defaultModel: "gemini-3.1-flash-image",
            },
          },
        },
      ]),
      { fetch: fetchMock },
    );

    await adapter.submit({
      connectionId: "weai-gemini-auto",
      operation: "image.generate",
      prompt: "Create a wide cinematic poster",
      idempotencyKey: "weai-gemini-auto",
      parameters: { n: 1, aspect_ratio: "auto", image_size: "auto" },
    });

    const [, init] = vi.mocked(fetchMock).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [{ parts: [{ text: "Create a wide cinematic poster" }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    });
  });

  it("accepts large MikotoPro Gemini 4K responses and falls back to the documented Markdown URL", async () => {
    const oversizedText = "x".repeat(16 * 1024 * 1024 + 1);
    const imageUrl = "https://api.funai.works/generated/mikoto-4k.png";
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: oversizedText },
                { text: `![Generated Image](${imageUrl})` },
              ],
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "mikoto-gemini-large",
          provider: "weai",
          apiKey: "mikoto-secret",
          baseUrl: "https://api.mikoto.vip",
          settings: {
            supplierKey: "mikoto",
            modelGroup: "Gemini 原生图片",
            protocol: "gemini-generate-content",
            defaultModel: "gemini-3.1-flash-image-preview",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    const task = await adapter.submit({
      connectionId: "mikoto-gemini-large",
      operation: "image.generate",
      prompt: "A detailed 4K poster",
      idempotencyKey: "mikoto-gemini-large-1",
      parameters: { image_size: "4K", aspect_ratio: "2:3" },
    });

    expect(await adapter.extractOutputs(task.result)).toEqual([
      { kind: "image", url: imageUrl },
    ]);
  });

  it("uses the native Gemini model-list route and canonicalizes preview aliases", async () => {
    const documentedIds = ["gemini-3-pro-image", "gemini-3.1-flash-image"];
    const remoteIds = [
      ...documentedIds,
      "gemini-3.0-pro-image",
      "gemini-3.1-flash-image-preview",
    ];
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: remoteIds.map((id) => ({ name: `models/${id}` })),
      }),
    ) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-gemini",
          provider: "weai",
          apiKey: "sk-weai",
          baseUrl: "https://asian-acc.we-token.cc/v1beta",
          settings: {
            modelGroup: "gemini香蕉",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    await adapter.testConnection("weai-gemini");
    const models = await adapter.listModels("weai-gemini");
    expect(vi.mocked(fetchMock).mock.calls.map(([url]) => String(url))).toEqual(
      [
        "https://asian-acc.we-token.cc/v1beta/models",
        "https://asian-acc.we-token.cc/v1beta/models",
      ],
    );
    expect(models.map((model) => model.id)).toEqual([...documentedIds].sort());
    const defaultModel = models.find(
      (model) => model.id === "gemini-3.1-flash-image",
    );
    expect(defaultModel).toMatchObject({
      name: "Gemini 3.1 Flash Image（1K $0.04/张 · 2K $0.06/张 · 4K $0.08/张）",
      isDefault: true,
      limits: { maxInputImages: 14 },
      metadata: {
        fixedOutputCount: 1,
        protocol: "gemini-generate-content",
      },
    });
    expect(
      defaultModel?.parameters?.find(
        (parameter) => parameter.key === "image_size",
      ),
    ).toMatchObject({
      default: "4K",
      options: [
        {
          label: "自动（提示词优先，其次参考图）",
          value: "auto",
        },
        { label: "512 px", value: "512" },
        { label: "1K", value: "1K" },
        { label: "2K", value: "2K" },
        { label: "4K", value: "4K" },
      ],
    });
    expect(models.some((model) => model.id.endsWith("-preview"))).toBe(false);
    expect(
      defaultModel?.parameters
        ?.find((parameter) => parameter.key === "aspect_ratio")
        ?.options?.map((option) => option.value),
    ).toEqual([
      "auto",
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
      "1:8",
      "8:1",
      "1:4",
      "4:1",
    ]);
  });

  it("dispatches the Gemini OpenAI-compatible protocol for listing, generate, and both edit bodies", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/models")) {
        return jsonResponse({
          data: [
            { id: "gemini-3.1-flash-image" },
            { id: "gemini-3-pro-image" },
            { id: "gemini-3.1-flash-image-preview" },
          ],
        });
      }
      return jsonResponse({ data: [{ url: "https://cdn.test/result.webp" }] });
    }) as unknown as typeof fetch;
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-gemini-compatible",
          provider: "weai",
          apiKey: "sk-weai",
          baseUrl: "https://asian-acc.we-token.cc/v1beta",
          settings: {
            modelGroup: "gemini香蕉",
            protocol: "gemini-openai-compatible",
            defaultModel: "gemini-3.1-flash-image",
          },
        },
      ]),
      { fetch: fetchMock },
    );

    await adapter.testConnection("weai-gemini-compatible");
    const models = await adapter.listModels("weai-gemini-compatible");
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.slice(0, 2)
        .map(([url]) => String(url)),
    ).toEqual([
      "https://asian-acc.we-token.cc/v1/models",
      "https://asian-acc.we-token.cc/v1/models",
    ]);
    expect(models.map((model) => model.id)).toEqual([
      "gemini-3-pro-image",
      "gemini-3.1-flash-image",
    ]);
    const compatibleDefault = models.find(
      (model) => model.id === "gemini-3.1-flash-image",
    );
    expect(compatibleDefault?.metadata).toMatchObject({
      protocol: "gemini-openai-compatible",
      fixedOutputCount: 1,
    });
    expect(
      compatibleDefault?.parameters
        ?.find((parameter) => parameter.key === "size")
        ?.options?.map((option) => option.value),
    ).toEqual(["auto", "1K", "2K", "4K"]);
    expect(
      compatibleDefault?.parameters?.some(
        (parameter) => parameter.key === "image_size",
      ),
    ).toBe(false);

    const generateTask = await adapter.submit({
      connectionId: "weai-gemini-compatible",
      operation: "image.generate",
      prompt: "A bright editorial illustration",
      idempotencyKey: "gemini-compatible-generate",
      parameters: { n: 1, size: "1k", aspect_ratio: "16:9" },
    });
    await adapter.submit({
      connectionId: "weai-gemini-compatible",
      operation: "image.edit",
      model: "gemini-3-pro-image-preview",
      prompt: "Reframe the remote reference",
      idempotencyKey: "gemini-compatible-url-edit",
      parameters: { n: 1, size: "2K", aspect_ratio: "4:3" },
      assets: [
        {
          id: "remote-reference",
          kind: "image",
          mimeType: "image/png",
          url: "https://assets.test/reference.png",
        },
      ],
    });
    await adapter.submit({
      connectionId: "weai-gemini-compatible",
      operation: "image.edit",
      model: "gemini-3-pro-image",
      prompt: "Reframe the local reference",
      idempotencyKey: "gemini-compatible-local-edit",
      parameters: { n: 1, size: "4k", aspect_ratio: "9:16" },
      assets: [
        {
          id: "local-reference",
          kind: "image",
          mimeType: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });
    await adapter.submit({
      connectionId: "weai-gemini-compatible",
      operation: "image.generate",
      prompt: "Let the prompt choose the best output dimensions",
      idempotencyKey: "gemini-compatible-auto",
      parameters: { n: 1, size: "auto", aspect_ratio: "auto" },
    });

    const calls = vi.mocked(fetchMock).mock.calls.slice(2);
    const [generateUrl, generateInit] = calls[0] ?? [];
    expect(String(generateUrl)).toBe(
      "https://asian-acc.we-token.cc/v1/images/generations",
    );
    expect(JSON.parse(String(generateInit?.body))).toEqual({
      model: "gemini-3.1-flash-image",
      prompt: "A bright editorial illustration",
      size: "1K",
      aspectRatio: "16:9",
      response_format: "url",
    });

    const [urlEditUrl, urlEditInit] = calls[1] ?? [];
    expect(String(urlEditUrl)).toBe(
      "https://asian-acc.we-token.cc/v1/images/edits",
    );
    expect(JSON.parse(String(urlEditInit?.body))).toEqual({
      model: "gemini-3-pro-image",
      prompt: "Reframe the remote reference",
      images: [{ image_url: "https://assets.test/reference.png" }],
      size: "2K",
      aspectRatio: "4:3",
      response_format: "url",
    });

    const [localEditUrl, localEditInit] = calls[2] ?? [];
    expect(String(localEditUrl)).toBe(
      "https://asian-acc.we-token.cc/v1/images/edits",
    );
    expect(localEditInit?.body).toBeInstanceOf(FormData);
    const localEditForm = localEditInit?.body as FormData;
    expect(localEditForm.get("model")).toBe("gemini-3-pro-image");
    expect(localEditForm.get("size")).toBe("4K");
    expect(localEditForm.get("aspectRatio")).toBe("9:16");
    expect(localEditForm.get("response_format")).toBe("url");
    expect(localEditForm.get("image")).toBeInstanceOf(Blob);
    expect(localEditForm.has("n")).toBe(false);

    const [, automaticInit] = calls[3] ?? [];
    expect(JSON.parse(String(automaticInit?.body))).toEqual({
      model: "gemini-3.1-flash-image",
      prompt: "Let the prompt choose the best output dimensions",
      response_format: "url",
    });

    const outputs = await adapter.extractOutputs(generateTask.result);
    expect(outputs).toEqual([
      {
        kind: "image",
        url: "https://cdn.test/result.webp",
        mimeType: "image/webp",
        filename: "weai-1.webp",
      },
    ]);

    const invalid512 = await adapter.validate({
      connectionId: "weai-gemini-compatible",
      operation: "image.generate",
      prompt: "Unsupported compatible resolution",
      idempotencyKey: "gemini-compatible-512",
      parameters: { size: "512" },
    });
    expect(invalid512.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_image_size" }),
      ]),
    );
  });

  it("enforces Gemini count, aspect, resolution, and reference-image limits", async () => {
    const adapter = new WeAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "weai-gemini",
          provider: "weai",
          apiKey: "sk-weai",
          settings: {
            config: {
              modelGroup: "gemini香蕉",
              defaultModel: "gemini-3-pro-image",
            },
          },
        },
      ]),
    );
    const assets = Array.from({ length: 15 }, (_, index) => ({
      id: `reference-${index}`,
      kind: "image" as const,
      mimeType: "image/png",
      data:
        index === 0
          ? new Uint8Array(20 * 1024 * 1024 + 1)
          : new Uint8Array([1]),
    }));

    const validation = await adapter.validate({
      connectionId: "weai-gemini",
      operation: "image.edit",
      prompt: "Combine these references",
      idempotencyKey: "invalid-gemini-request",
      parameters: { n: 2, aspect_ratio: "5:3", image_size: "8K" },
      assets,
    });
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "too_many_images",
        "image_too_large",
        "invalid_count",
        "invalid_aspect_ratio",
        "invalid_image_size",
      ]),
    );

    const unsupportedModel = await adapter.validate({
      connectionId: "weai-gemini",
      operation: "image.generate",
      model: "gpt-image-2",
      prompt: "Wrong protocol model",
      idempotencyKey: "invalid-gemini-model",
    });
    expect(unsupportedModel.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported_model", path: "model" }),
      ]),
    );

    for (const model of ["gemini-3.0-pro-image"]) {
      const marketplaceOnlyModel = await adapter.validate({
        connectionId: "weai-gemini",
        operation: "image.generate",
        model,
        prompt: "An undocumented alias",
        idempotencyKey: `invalid-${model}`,
      });
      expect(marketplaceOnlyModel.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "unsupported_model", path: "model" }),
          expect.objectContaining({
            code: "model_group_mismatch",
            path: "model",
          }),
        ]),
      );
    }

    for (const alias of [
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview",
    ]) {
      const normalizedAlias = await adapter.validate({
        connectionId: "weai-gemini",
        operation: "image.generate",
        model: alias,
        prompt: "Normalize a saved preview alias",
        idempotencyKey: `normalize-${alias}`,
      });
      expect(normalizedAlias.issues).toEqual([]);
    }
  });

  it("accepts snake-case Gemini inline image response fields", async () => {
    const adapter = new WeAIImageAdapter(new StaticConnectionResolver());
    const outputs = await adapter.extractOutputs({
      candidates: [
        {
          content: {
            parts: [
              {
                inline_data: {
                  mime_type: "image/webp",
                  data: Buffer.from("webp-output").toString("base64"),
                },
              },
            ],
          },
        },
      ],
    });
    expect(outputs[0]).toMatchObject({
      mimeType: "image/webp",
      filename: "weai-1.webp",
    });
    expect(Buffer.from(outputs[0]?.data ?? []).toString()).toBe("webp-output");
  });
});
