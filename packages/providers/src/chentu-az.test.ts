import { expect, it, vi } from "vitest";
import {
  chentuAzImageDescriptor,
  CHENTU_AZ_IMAGE_MODELS,
} from "./chentu-az.js";
import { OpenAIImageAdapter } from "./openai.js";
import { StaticConnectionResolver } from "./credentials.js";

it.each(CHENTU_AZ_IMAGE_MODELS)(
  "sends the verified %s payload without legacy fields",
  async (model) => {
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          data: [{ b64_json: Buffer.from("test bytes").toString("base64") }],
        }),
    );
    const adapter = new OpenAIImageAdapter(
      new StaticConnectionResolver([
        {
          id: "az",
          provider: "openai",
          apiKey: "test-key",
          baseUrl: "https://tu.988236.xyz/v1",
          settings: { supplierKey: "chentu", modelGroup: "image2官key生图" },
        },
      ]),
      { fetch: fetcher },
    );
    const request = {
      connectionId: "az",
      model,
      operation: "image.generate" as const,
      prompt: "test",
      idempotencyKey: "az-payload",
    };
    const descriptor = chentuAzImageDescriptor(model, "image2官key生图")!;
    expect(descriptor.parameters?.map((p) => p.key)).toEqual([
      "size",
      "quality",
    ]);
    expect(descriptor.metadata?.fixedOutputCount).toBe(1);
    for (const size of [
      "1824x1024",
      "1024x1824",
      "1792x768",
      "768x1792",
      "1024x768",
      "768x1024",
    ]) {
      expect(
        (
          await adapter.validate({
            ...request,
            parameters: { size, quality: "low" },
          })
        ).issues,
      ).toEqual([]);
      await adapter.submit({
        ...request,
        parameters: { size, quality: "low" },
      });
      expect(
        JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)),
      ).toMatchObject({ model, size, quality: "low" });
    }
    for (const size of ["1344x1024", "1024x1344", "1792x1024", "1024x1792"]) {
      expect(
        (
          await adapter.validate({
            ...request,
            parameters: { size, quality: "low" },
          })
        ).issues.map((issue) => issue.code),
      ).toContain("invalid_image_size");
    }
    fetcher.mockClear();
    await adapter.submit({
      ...request,
      parameters: {
        size: "1536x1024",
        quality: "low",
        response_format: "url",
        style: "vivid",
      },
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model,
      prompt: "test",
      size: "1536x1024",
      quality: "low",
      n: 1,
    });
    expect(
      (
        await adapter.validate({
          ...request,
          parameters: { size: "2048x2048", quality: "high" },
        })
      ).issues.map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining(["invalid_image_size", "invalid_quality"]),
    );
    fetcher.mockClear();
    await adapter.submit({
      ...request,
      operation: "image.edit",
      assets: [
        { kind: "image", data: new Uint8Array([1]), mimeType: "image/png" },
      ],
      parameters: { size: "1024x1024", quality: "low" },
    });
    const form = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("image")).toBeInstanceOf(File);
    expect(form.get("quality")).toBe("low");
    expect(form.has("response_format")).toBe(false);
    expect(form.has("style")).toBe(false);
  },
);

it("does not give another supplier group the AZ probe capabilities", () => {
  expect(
    chentuAzImageDescriptor("AZ-gpt-image-2", "低价Adobe生图"),
  ).toBeUndefined();
  expect(
    chentuAzImageDescriptor("AZ-gpt-image-new", "image2官key生图"),
  ).toBeUndefined();
});
