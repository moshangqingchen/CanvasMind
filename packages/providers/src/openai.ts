import type {
  FetchImplementation,
  ModelDescriptor,
  ModelParameterDescriptor,
  NormalizedRequest,
  ProviderAdapter,
  ProviderConnectionResolver,
  ProviderTask,
  RemoteArtifact,
  ResolvedProviderConnection,
  ValidationIssue,
  ValidationResult,
} from "./contracts.js";
import { assertValidResult, withCanonicalModelFields } from "./contracts.js";
import {
  assetToBlob,
  fetchProviderJson,
  joinUrl,
  mergeHeaders,
  requireApiKey,
} from "./http.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-2";

interface OpenAIModelList {
  data?: Array<{ id?: unknown }>;
}

interface OpenAIImageData {
  b64_json?: unknown;
  url?: unknown;
  mime_type?: unknown;
  output_format?: unknown;
  revised_prompt?: unknown;
}

interface OpenAIImageResponse {
  created?: unknown;
  data?: OpenAIImageData[];
  output_format?: unknown;
}

interface OpenAIImageTaskResult {
  response: OpenAIImageResponse;
  outputFormat: string;
}

interface ImageFormatDescriptor {
  format: "png" | "jpeg" | "webp";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpeg" | "webp";
}

const IMAGE_FORMATS: Readonly<
  Record<ImageFormatDescriptor["format"], ImageFormatDescriptor>
> = {
  png: { format: "png", mimeType: "image/png", extension: "png" },
  jpeg: { format: "jpeg", mimeType: "image/jpeg", extension: "jpeg" },
  webp: { format: "webp", mimeType: "image/webp", extension: "webp" },
};

const SUPPORTED_INPUT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_EDIT_IMAGE_BYTES = 50 * 1024 * 1024;

const IMAGE_PARAMETER_DESCRIPTORS: readonly ModelParameterDescriptor[] = [
  {
    key: "size",
    label: "尺寸",
    control: "text",
    valueType: "string",
    default: "1024x1024",
    placeholder: "1024x1024",
    options: [
      { label: "自动", value: "auto" },
      { label: "方形 1024 x 1024", value: "1024x1024" },
      { label: "横向 1536 x 1024", value: "1536x1024" },
      { label: "竖向 1024 x 1536", value: "1024x1536" },
    ],
    operations: ["image.generate", "image.edit"],
  },
  {
    key: "quality",
    label: "质量",
    control: "select",
    valueType: "string",
    default: "auto",
    options: [
      { label: "自动", value: "auto" },
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
    ],
    operations: ["image.generate", "image.edit"],
  },
  {
    key: "n",
    label: "数量",
    control: "number",
    valueType: "integer",
    default: 1,
    min: 1,
    max: 10,
    step: 1,
    operations: ["image.generate", "image.edit"],
  },
  {
    key: "output_format",
    label: "格式",
    control: "select",
    valueType: "string",
    default: "png",
    options: [
      { label: "PNG", value: "png" },
      { label: "JPEG", value: "jpeg" },
      { label: "WebP", value: "webp" },
    ],
    operations: ["image.generate", "image.edit"],
  },
  {
    key: "output_compression",
    label: "压缩率",
    control: "number",
    valueType: "integer",
    default: 100,
    min: 0,
    max: 100,
    step: 1,
    description: "仅 JPEG 与 WebP 使用",
    operations: ["image.generate", "image.edit"],
  },
];

function gptImage2SizeIssue(value: string): string | undefined {
  if (value === "auto") return undefined;
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (!match) return "must be auto or WIDTHxHEIGHT";
  const width = Number(match[1]);
  const height = Number(match[2]);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const pixels = width * height;
  if (width % 16 !== 0 || height % 16 !== 0)
    return "edges must be multiples of 16 pixels";
  if (longEdge > 3840) return "maximum edge length is 3840 pixels";
  if (longEdge / shortEdge > 3) return "edge ratio cannot exceed 3:1";
  if (pixels < 655_360 || pixels > 8_294_400)
    return "total pixels must be between 655360 and 8294400";
  return undefined;
}

const IMAGE_MODELS: readonly ModelDescriptor[] = [
  {
    id: DEFAULT_MODEL,
    name: "GPT Image 2",
    operations: ["image.generate", "image.edit"],
    parameters: IMAGE_PARAMETER_DESCRIPTORS,
    isDefault: true,
    limits: {
      maxInputImages: 16,
      supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    },
  },
  {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    operations: ["image.generate", "image.edit"],
    parameters: IMAGE_PARAMETER_DESCRIPTORS,
  },
  {
    id: "gpt-image-1",
    name: "GPT Image 1",
    operations: ["image.generate", "image.edit"],
    parameters: IMAGE_PARAMETER_DESCRIPTORS,
  },
];

function imageParameters(
  parameters: Readonly<Record<string, unknown>> | undefined,
) {
  if (!parameters) return {};
  const permitted = [
    "background",
    "moderation",
    "n",
    "output_compression",
    "output_format",
    "quality",
    "size",
    "user",
  ] as const;
  return Object.fromEntries(
    permitted.flatMap((key) =>
      parameters[key] === undefined ? [] : [[key, parameters[key]]],
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringSetting(
  settings: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = settings?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function configuredDefaultModel(
  connection: ResolvedProviderConnection,
  fallback: string,
): string {
  const direct = stringSetting(connection.settings, "defaultModel");
  const nestedConfig = connection.settings?.["config"];
  const nested = isRecord(nestedConfig)
    ? stringSetting(nestedConfig, "defaultModel")
    : undefined;
  return direct ?? nested ?? fallback;
}

function imageFormat(value: unknown): ImageFormatDescriptor | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^image\//u, "")
    .replace(/^\./u, "");
  if (normalized === "jpg") return IMAGE_FORMATS.jpeg;
  if (normalized === "png" || normalized === "jpeg" || normalized === "webp") {
    return IMAGE_FORMATS[normalized];
  }
  return undefined;
}

function imageFormatFromBytes(
  data: Uint8Array,
): ImageFormatDescriptor | undefined {
  if (
    data.byteLength >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return IMAGE_FORMATS.png;
  }
  if (
    data.byteLength >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return IMAGE_FORMATS.jpeg;
  }
  if (
    data.byteLength >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return IMAGE_FORMATS.webp;
  }
  return undefined;
}

function imageFormatFromUrl(value: string): ImageFormatDescriptor | undefined {
  const dataMime = /^data:([^;,]+)/iu.exec(value)?.[1];
  if (dataMime) return imageFormat(dataMime);
  try {
    const pathname = new URL(value).pathname;
    return imageFormat(/\.([^.\/]+)$/u.exec(pathname)?.[1]);
  } catch {
    return undefined;
  }
}

function filenameFor(
  index: number,
  original: string | undefined,
  mimeType: string,
): string {
  if (original && original.trim().length > 0) return original;
  const extension = imageFormat(mimeType)?.extension ?? "png";
  return `reference-${index + 1}.${extension}`;
}

function hasAssetContent(asset: {
  readonly url?: string;
  readonly data?: Uint8Array;
}): boolean {
  return (
    (typeof asset.url === "string" && asset.url.trim().length > 0) ||
    (asset.data !== undefined && asset.data.byteLength > 0)
  );
}

export interface OpenAIImageAdapterOptions {
  fetch?: FetchImplementation;
  defaultModel?: string;
  requestTimeoutMs?: number;
}

export class OpenAIImageAdapter implements ProviderAdapter {
  private readonly fetchImpl: FetchImplementation;
  private readonly defaultModel: string;
  private readonly requestTimeoutMs: number;

  public constructor(
    private readonly connections: ProviderConnectionResolver,
    options: OpenAIImageAdapterOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  }

  public async testConnection(connectionId: string): Promise<void> {
    const connection = await this.connections.resolve(connectionId);
    const headers = mergeHeaders(connection.headers, {
      Authorization: `Bearer ${requireApiKey(connection)}`,
    });
    await fetchProviderJson<OpenAIModelList>(
      this.fetchImpl,
      joinUrl(connection.baseUrl ?? DEFAULT_BASE_URL, "/models"),
      { method: "GET", headers },
      { phase: "connect", timeoutMs: this.requestTimeoutMs },
    );
  }

  public async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    const connection = await this.connections.resolve(connectionId);
    const defaultModel = configuredDefaultModel(connection, this.defaultModel);
    const headers = mergeHeaders(connection.headers, {
      Authorization: `Bearer ${requireApiKey(connection)}`,
    });
    const response = await fetchProviderJson<OpenAIModelList>(
      this.fetchImpl,
      joinUrl(connection.baseUrl ?? DEFAULT_BASE_URL, "/models"),
      { method: "GET", headers },
      { phase: "connect", timeoutMs: this.requestTimeoutMs },
    );
    const ids = new Set(
      (response.data ?? [])
        .map((model) => model.id)
        .filter(
          (id): id is string => typeof id === "string" && id.includes("image"),
        ),
    );
    ids.add(defaultModel);
    return [...ids].sort().map((id) => {
      const known = IMAGE_MODELS.find((model) => model.id === id);
      if (known)
        return withCanonicalModelFields(
          { ...known, isDefault: id === defaultModel },
          "openai",
        );
      return withCanonicalModelFields(
        {
          id,
          name: id,
          operations: ["image.generate", "image.edit"],
          parameters: IMAGE_PARAMETER_DESCRIPTORS,
          isDefault: id === defaultModel,
        },
        "openai",
      );
    });
  }

  public async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    let resolvedConnection: ResolvedProviderConnection | undefined;
    try {
      const connection = await this.connections.resolve(request.connectionId);
      resolvedConnection = connection;
      if (!connection.apiKey) {
        issues.push({
          path: "connection.apiKey",
          code: "missing_credential",
          message: "An OpenAI API key is required",
        });
      }
    } catch (error) {
      issues.push({
        path: "connectionId",
        code: "unknown_connection",
        message:
          error instanceof Error
            ? error.message
            : "Unknown provider connection",
      });
    }
    if (
      request.operation !== "image.generate" &&
      request.operation !== "image.edit"
    ) {
      issues.push({
        path: "operation",
        code: "unsupported_operation",
        message:
          "OpenAI image adapter only supports image generation and editing",
      });
    }
    if (request.prompt.trim().length === 0) {
      issues.push({
        path: "prompt",
        code: "required",
        message: "An image prompt is required",
      });
    }
    const assets = request.assets ?? [];
    const images = assets.filter((asset) => asset.kind === "image");
    if (request.operation === "image.generate" && assets.length > 0) {
      issues.push({
        path: "assets",
        code: "assets_not_supported",
        message:
          "Image generation does not accept reference assets; use image editing instead",
      });
    }
    if (request.operation === "image.edit" && images.length === 0) {
      issues.push({
        path: "assets",
        code: "reference_required",
        message: "Image editing requires at least one reference image",
      });
    }
    if (images.length > 16) {
      issues.push({
        path: "assets",
        code: "too_many_images",
        message: "OpenAI image editing accepts at most 16 reference images",
      });
    }
    for (const [index, asset] of assets.entries()) {
      if (asset.kind !== "image") {
        issues.push({
          path: `assets[${index}].kind`,
          code: "unsupported_asset_kind",
          message: "OpenAI image requests only accept image assets",
        });
        continue;
      }
      const mimeType =
        asset.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!SUPPORTED_INPUT_MIME_TYPES.has(mimeType)) {
        issues.push({
          path: `assets[${index}].mimeType`,
          code: "unsupported_mime_type",
          message: `Unsupported OpenAI reference image MIME type: ${asset.mimeType}`,
        });
      }
      if (!hasAssetContent(asset)) {
        issues.push({
          path: `assets[${index}]`,
          code: "unresolved_asset",
          message: `Reference image ${asset.id} has no usable content`,
        });
      }
      if (asset.data && asset.data.byteLength > MAX_EDIT_IMAGE_BYTES) {
        issues.push({
          path: `assets[${index}].data`,
          code: "image_too_large",
          message: "OpenAI reference images must not exceed 50 MB",
        });
      }
    }
    const outputFormat = request.parameters?.["output_format"];
    if (outputFormat !== undefined && imageFormat(outputFormat) === undefined) {
      issues.push({
        path: "parameters.output_format",
        code: "invalid_output_format",
        message: "OpenAI output_format must be png, jpeg, or webp",
      });
    }
    const outputCompression = request.parameters?.["output_compression"];
    if (
      outputCompression !== undefined &&
      (typeof outputCompression !== "number" ||
        !Number.isInteger(outputCompression) ||
        outputCompression < 0 ||
        outputCompression > 100)
    ) {
      issues.push({
        path: "parameters.output_compression",
        code: "invalid_output_compression",
        message:
          "OpenAI output_compression must be an integer between 0 and 100",
      });
    }
    const background = request.parameters?.["background"];
    if (
      background !== undefined &&
      (typeof background !== "string" ||
        !["auto", "opaque", "transparent"].includes(background))
    )
      issues.push({
        path: "parameters.background",
        code: "invalid_background",
        message: "OpenAI background must be auto, opaque, or transparent",
      });
    const count = request.parameters?.["n"];
    if (
      count !== undefined &&
      (typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 10)
    ) {
      issues.push({
        path: "parameters.n",
        code: "invalid_count",
        message: "OpenAI n must be an integer between 1 and 10",
      });
    }
    for (const key of ["size", "quality"] as const) {
      const value = request.parameters?.[key];
      if (
        value !== undefined &&
        (typeof value !== "string" || value.trim().length === 0)
      ) {
        issues.push({
          path: `parameters.${key}`,
          code: "invalid_parameter",
          message: `OpenAI ${key} must be a non-empty string`,
        });
      }
    }
    const resolvedModel =
      request.model ??
      (resolvedConnection
        ? configuredDefaultModel(resolvedConnection, this.defaultModel)
        : this.defaultModel);
    if (resolvedModel === "gpt-image-2") {
      const size = request.parameters?.["size"];
      if (typeof size === "string") {
        const reason = gptImage2SizeIssue(size.trim());
        if (reason)
          issues.push({
            path: "parameters.size",
            code: "invalid_size",
            message: `OpenAI gpt-image-2 size ${reason}`,
          });
      }
      const quality = request.parameters?.["quality"];
      if (
        quality !== undefined &&
        (typeof quality !== "string" ||
          !["auto", "low", "medium", "high"].includes(quality))
      )
        issues.push({
          path: "parameters.quality",
          code: "invalid_quality",
          message:
            "OpenAI gpt-image-2 quality must be auto, low, medium, or high",
        });
      if (background === "transparent")
        issues.push({
          path: "parameters.background",
          code: "unsupported_background",
          message:
            "OpenAI gpt-image-2 does not support transparent backgrounds",
        });
    }
    const moderation = request.parameters?.["moderation"];
    if (
      moderation !== undefined &&
      (typeof moderation !== "string" || !["auto", "low"].includes(moderation))
    )
      issues.push({
        path: "parameters.moderation",
        code: "invalid_moderation",
        message: "OpenAI moderation must be auto or low",
      });
    if (
      outputCompression !== undefined &&
      imageFormat(outputFormat)?.format !== "jpeg" &&
      imageFormat(outputFormat)?.format !== "webp"
    )
      issues.push({
        path: "parameters.output_compression",
        code: "compression_requires_lossy_format",
        message:
          "OpenAI output_compression requires jpeg or webp output_format",
      });
    if (request.model !== undefined && request.model.trim().length === 0) {
      issues.push({
        path: "model",
        code: "invalid_model",
        message: "OpenAI model must be a non-empty string",
      });
    }
    return { valid: issues.length === 0, issues };
  }

  public async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    const connection = await this.connections.resolve(request.connectionId);
    const apiKey = requireApiKey(connection);
    const baseUrl = connection.baseUrl ?? DEFAULT_BASE_URL;
    const model =
      request.model ?? configuredDefaultModel(connection, this.defaultModel);
    const requestedOutputFormat =
      imageFormat(request.parameters?.["output_format"]) ?? IMAGE_FORMATS.png;
    const commonHeaders = mergeHeaders(connection.headers, {
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": request.idempotencyKey,
    });
    let response: OpenAIImageResponse;

    if (request.operation === "image.edit") {
      // A connection may carry a default JSON Content-Type. FormData needs
      // fetch to provide the multipart boundary instead.
      commonHeaders.delete("content-type");
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", request.prompt);
      for (const [key, value] of Object.entries(
        imageParameters(request.parameters),
      )) {
        form.set(key, String(value));
      }
      const images = (request.assets ?? []).filter(
        (asset) => asset.kind === "image",
      );
      for (const [index, image] of images.entries()) {
        const blob = await assetToBlob(image, this.fetchImpl);
        const field = images.length === 1 ? "image" : "image[]";
        form.append(
          field,
          blob,
          filenameFor(index, image.filename, image.mimeType),
        );
      }
      response = await fetchProviderJson<OpenAIImageResponse>(
        this.fetchImpl,
        joinUrl(baseUrl, "/images/edits"),
        { method: "POST", headers: commonHeaders, body: form },
        {
          phase: "submit",
          timeoutMs: this.requestTimeoutMs,
          // The header lets a provider implement deduplication, but OpenAI's
          // image endpoint does not provide a documented replay guarantee.
          // Treat a lost response as ambiguous rather than auto-resubmitting.
          idempotent: false,
        },
      );
    } else {
      commonHeaders.set("content-type", "application/json");
      response = await fetchProviderJson<OpenAIImageResponse>(
        this.fetchImpl,
        joinUrl(baseUrl, "/images/generations"),
        {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            model,
            prompt: request.prompt,
            ...imageParameters(request.parameters),
          }),
        },
        {
          phase: "submit",
          timeoutMs: this.requestTimeoutMs,
          idempotent: false,
        },
      );
    }

    return {
      providerTaskId: `openai:${request.idempotencyKey}`,
      id: `openai:${request.idempotencyKey}`,
      status: "succeeded",
      result: {
        response,
        outputFormat: requestedOutputFormat.format,
      } satisfies OpenAIImageTaskResult,
    };
  }

  public async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    if (!result || typeof result !== "object") return [];
    const envelope =
      isRecord(result) && isRecord(result.response)
        ? (result as unknown as OpenAIImageTaskResult)
        : undefined;
    const response = envelope?.response ?? (result as OpenAIImageResponse);
    if (!Array.isArray(response.data)) return [];
    return response.data.flatMap((item, index): RemoteArtifact[] => {
      if (typeof item.b64_json === "string") {
        const data = new Uint8Array(Buffer.from(item.b64_json, "base64"));
        const format =
          imageFormatFromBytes(data) ??
          imageFormat(item.mime_type) ??
          imageFormat(item.output_format) ??
          imageFormat(response.output_format) ??
          imageFormat(envelope?.outputFormat) ??
          IMAGE_FORMATS.png;
        return [
          {
            kind: "image" as const,
            data,
            mimeType: format.mimeType,
            filename: `openai-${index + 1}.${format.extension}`,
          },
        ];
      }
      if (typeof item.url === "string") {
        const format =
          imageFormatFromUrl(item.url) ??
          imageFormat(item.mime_type) ??
          imageFormat(item.output_format) ??
          imageFormat(response.output_format) ??
          imageFormat(envelope?.outputFormat);
        return [
          {
            kind: "image" as const,
            url: item.url,
            ...(format
              ? {
                  mimeType: format.mimeType,
                  filename: `openai-${index + 1}.${format.extension}`,
                }
              : {}),
          },
        ];
      }
      return [];
    });
  }
}

export const OPENAI_DEFAULT_IMAGE_MODEL = DEFAULT_MODEL;
export const OpenAIAdapter = OpenAIImageAdapter;
