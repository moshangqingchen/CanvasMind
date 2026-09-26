import { expect, it, vi } from "vitest";
import {
  GenericRestAdapter,
  StaticConnectionResolver,
} from "@super-canvas/providers";
import {
  CHENTU_NATIVE_GEMINI_MODELS,
  chentuNativeGeminiConnector,
  chentuNativeGeminiDescriptor,
} from "./chentu-gemini";
import {
  chentuCatalogFromPricing,
  resolveChentuScannedGroup,
} from "./chentu-catalog";

it.each(CHENTU_NATIVE_GEMINI_MODELS)(
  "uses the exact native alias %s for generation and multiple reference images",
  async (model) => {
    const connector = chentuNativeGeminiConnector([
      chentuNativeGeminiDescriptor(model),
    ]);
    for (const imageSize of ["1K", "2K", "4K"] as const) {
    for (const operation of ["image.generate", "image.edit"] as const) {
      const fetchImpl = vi.fn(async (url, init) => {
        expect(String(url)).toBe(
          `https://tu.988236.xyz/v1beta/models/${model}:generateContent`,
        );
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(
          "test-secret",
        );
        const body = JSON.parse(String(init?.body));
        expect(body.generationConfig).toEqual({
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "4:3", imageSize },
        });
        expect(body.contents[0].parts[0]).toEqual({ text: "green cup" });
        expect(body.contents[0].parts).toHaveLength(
          operation === "image.edit" ? 3 : 1,
        );
        if (operation === "image.edit") {
          expect(body.contents[0].parts[1].inline_data.data).toBe(
            Buffer.from([1]).toString("base64"),
          );
          expect(body.contents[0].parts[2].inline_data.data).toBe(
            Buffer.from([2]).toString("base64"),
          );
        }
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Done" },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: Buffer.from("result").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        });
      });
      const adapter = new GenericRestAdapter(
        new StaticConnectionResolver([
          {
            id: "test",
            provider: "rest",
            apiKey: "test-secret",
            baseUrl: "https://tu.988236.xyz/v1",
          },
        ]),
        { config: connector, fetch: fetchImpl },
      );
      const task = await adapter.submit({
        connectionId: "test",
        model,
        operation,
        prompt: "green cup",
        idempotencyKey: `${model}-${operation}`,
        parameters: { aspect_ratio: "4:3", image_size: imageSize },
        assets:
          operation === "image.edit"
            ? [1, 2].map((n) => ({
                id: String(n),
                kind: "image" as const,
                mimeType: "image/png",
                data: new Uint8Array([n]),
              }))
            : [],
      });
      expect(task.status).toBe("succeeded");
      expect(await adapter.extractOutputs(task.result)).toEqual([
        {
          kind: "image",
          mimeType: "image/jpeg",
          data: new Uint8Array(Buffer.from("result")),
        },
      ]);
    }
    }
  },
);

it("keeps native parameters and pricing after marketplace and keyed inventory resolution", () => {
  const catalog = chentuCatalogFromPricing({
    group_ratio: { 低价gemni生图: 1 },
    data: CHENTU_NATIVE_GEMINI_MODELS.map((model_name) => ({
      model_name,
      model_price: 0.05,
      enable_groups: ["低价gemni生图"],
      supported_endpoint_types: ["gemini", "openai"],
    })),
  });
  const resolved = resolveChentuScannedGroup(catalog, "低价gemni生图", [
    ...CHENTU_NATIVE_GEMINI_MODELS,
    "unknown-gemini-image",
  ]);
  expect(resolved.canvasModels).toHaveLength(3);
  for (const model of resolved.canvasModels) {
    expect(model.metadata).toMatchObject({
      protocol: "gemini-generate-content",
      canvasRunnable: true,
    });
    expect(model.parameters?.map((p) => p.key)).toEqual([
      "aspect_ratio",
      "image_size",
    ]);
    expect(model.name).toContain("0.05");
    expect(model.parameters?.find(p => p.key === "image_size")?.options?.map(o => o.value)).toEqual(["1K", "2K", "4K"]);
  }
});
