import type {
  ModelDescriptor,
  RestConnectorConfig,
  RestRequestDefinition,
} from "@super-canvas/providers";

// Exact IDs tested against the keyed Gemini endpoint on 2026-09-10.
// Their OpenAI Images requests fail upstream with convert_request_failed.
export const CHENTU_NATIVE_GEMINI_MODELS = [
  "ad-gemini-3-pro-image-preview",
  "ad-gemini-3.1-flash-image-preview",
  "leo-gemini-3.1-flash-image-preview",
] as const;
export function isChentuNativeGeminiModel(id: string): boolean {
  return (CHENTU_NATIVE_GEMINI_MODELS as readonly string[]).includes(id);
}

export function chentuNativeGeminiDescriptor(id: string): ModelDescriptor {
  return {
    id,
    name: id,
    operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image", "image[]"],
    outputKinds: ["image"],
    parameters: [
      {
        key: "aspect_ratio",
        label: "画面比例",
        control: "select",
        valueType: "string",
        default: "auto",
        options: [
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
        ].map((value) => ({
          value,
          label: value === "auto" ? "自动（提示词优先，其次参考图）" : value,
        })),
      },
      {
        key: "image_size",
        label: "分辨率",
        control: "select",
        valueType: "string",
        default: "1K",
        options: ["1K", "2K", "4K"].map(value => ({ label: value, value })),
        description: "按所选分辨率和画面比例生成，原生接口传递 imageSize。",
      },
    ],
    limits: {
      maxInputImages: 10,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    metadata: {
      supplier: "chentu",
      protocol: "gemini-generate-content",
      canvasRunnable: true,
      supportsImageEdit: true,
      verificationSource: "docs/chentu-gemini-verification-2026-09-10.md",
    },
  };
}

function nativeRequest(id: string): RestRequestDefinition {
  return {
    path: `/v1beta/models/${encodeURIComponent(id)}:generateContent`,
    method: "POST",
    bodyMode: "json",
    template: {
      contents: [{ role: "user", parts: [{ text: "" }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { imageSize: "1K" },
      },
    },
    mappings: [
      {
        target: "/contents/0/parts/0/text",
        source: { kind: "request", path: "$.prompt" },
      },
      ...Array.from({ length: 10 }, (_, offset) => ({
        target: `/contents/0/parts/${offset + 1}`,
        source: {
          kind: "assets" as const,
          assetKind: "image" as const,
          select: "first" as const,
          offset,
          encoding: "gemini-part" as const,
        },
        omitIfUndefined: true,
      })),
      {
        target: "/generationConfig/imageConfig/aspectRatio",
        source: { kind: "request", path: "$.parameters.aspect_ratio" },
        omitIfUndefined: true,
        omitValues: ["auto"],
      },
      {
        target: "/generationConfig/imageConfig/imageSize",
        source: { kind: "request", path: "$.parameters.image_size" },
        omitIfUndefined: true,
      },
    ],
    response: { errorPath: "$.error.message" },
  };
}

export function chentuNativeGeminiConnector(
  models: readonly ModelDescriptor[],
): RestConnectorConfig {
  const native = models.filter((m) => isChentuNativeGeminiModel(m.id));
  if (!native.length) throw new Error("No verified Chentu Gemini models");
  return {
    auth: { type: "header", headerName: "x-goog-api-key" },
    models: structuredClone(native),
    restrictModels: true,
    submit: nativeRequest(native[0]!.id),
    modelOverrides: Object.fromEntries(
      native.map((m) => [m.id, { submit: nativeRequest(m.id) }]),
    ),
    output: {
      path: "$.candidates[0].content.parts",
      kind: "image",
      base64Path: "inlineData.data",
      base64FallbackPaths: ["inline_data.data"],
      mimeTypePath: "inlineData.mimeType",
      defaultMimeType: "image/png",
    },
  };
}
