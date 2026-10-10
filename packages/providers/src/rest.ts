import { createHmac, timingSafeEqual } from "node:crypto";
import { videoOutputParametersFromBody } from "./video-output-contract.js";
import type {
  ArtifactKind,
  FetchImplementation,
  ModelDescriptor,
  NormalizedRequest,
  NormalizedTaskState,
  ProviderAdapter,
  ProviderAssetInput,
  ProviderConnectionResolver,
  ProviderOperation,
  ProviderTask,
  ProviderTaskStatus,
  RemoteArtifact,
  ValidationIssue,
  ValidationResult,
} from "./contracts.js";
import { referenceImageHostingEnabled, uploadTemporaryReferenceImages } from "./reference-image-hosting.js";
import { canApplyCangyuanCurrentContract, managesCangyuanCurrentTransport, cangyuanCurrentRequestIssues, cangyuanCurrentTransport, isCangyuanCurrentRequest, withCangyuanCurrentRequestParameters } from "./cangyuan-current-models.js";
import { cangyuanMusicModel, cangyuanMusicRequestIssues, cangyuanMusicTransport, isCangyuanMusicRequest, withCangyuanMusicRequestParameters } from "./cangyuan-music.js";
import { cangyuanVideoModel, cangyuanVideoTransport, isCangyuanVideoRequest, normalizeCangyuanVideoParameters, validateCangyuanVideoRequest } from "./cangyuan-video-contract.js";
import { remainingVideoSupplier, isRemainingVideoModel, remainingVideoModel, remainingVideoTransport, remainingVideoRequiresPublicUrls, restoreRemainingVideoModel, isRemainingVideoPublicHttpsUrl, normalizeRemainingVideoParameters, remainingVideoRequestIssues, type RemainingVideoContext } from "./remaining-video-contracts.js";
import { modelSupportsGenerationMedia } from "./model-media.js";
import { isMiaowuLegacyVideoBaseConnector, isMiaowuUnverifiedAutoVideoContract, MIAOWU_VIDEO_CONTRACT_PENDING_REASON } from "./miaowu-video-contract-pending.js";
import { getModelParameterDescriptor, validateModelParameters } from "./cli-contracts.js";
import { chatMediaOutputs } from "./chat-image-output.js";
import { isJiasuApiUrl, jiasuVideoGroupMismatch } from "./jiasu-video-contract.js";
import { isJijiuApiUrl, jijiuVideoGroupMismatch } from "./jijiu-video-contract.js";
import { uploadJiasuMedia } from "./jiasu-media.js";

function remainingVideoContext(settings: Readonly<Record<string, unknown>> | undefined, model?: ModelDescriptor, assets?: readonly ProviderAssetInput[]): RemainingVideoContext {
  const group = settings?.accountKeyGroup ?? settings?.modelGroup ?? settings?.group ?? settings?.supplierGroupId;
  const description = settings?.supplierGroupDescription ?? settings?.groupDescription;
  return { ...(typeof group === "string" ? { group } : {}), ...(typeof description === "string" ? { groupDescription: description } : {}), ...(model ? { model } : {}), ...(assets ? { assets } : {}) };
}
/** Current Miaowu core routes replace only automatic directory mappings. */
export function preservesMiaowuExplicitVideoContract(config: Readonly<Record<string, unknown>>, model: ModelDescriptor | undefined, operation?: ProviderOperation): boolean {
  if (remainingVideoSupplier(config.baseUrl) !== "miaowu" || !model || !["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal", "video-editing"].includes(model.id)) return false;
  if (model.metadata?.source === "manual" || model.metadata?.protocolEvidence === "paid-test" || ["pricing.video_api", "dream.video_schema"].includes(String(model.metadata?.parameterSource))) return true;
  const bindings = config.autoModelInterfaces as Record<string, { model?: ModelDescriptor }> | undefined;
  if (bindings?.[model.id]?.model?.id === model.id) return true;
  const connector = config.connector as RestConnectorConfig | undefined;
  const overrides = operation ? [connector?.operationOverrides?.[operation], connector?.modelOverrides?.[model.id]?.operationOverrides?.[operation]] : [];
  if (overrides.some(override => override && Object.keys(override).length > 0)) return true;
  if (connector && !connector.modelOverrides?.[model.id] && !isMiaowuLegacyVideoBaseConnector(connector)) {
    const current = remainingVideoTransport("miaowu", model.id, { model });
    if (JSON.stringify(connector.submit) !== JSON.stringify(current?.submit) || JSON.stringify(connector.output) !== JSON.stringify(current?.output)) return true;
  }
  return Boolean(connector?.modelOverrides?.[model.id] && model.metadata?.parameterSource === "key-model-scan" &&
    !isMiaowuUnverifiedAutoVideoContract(config, model, connector, operation));
}
import { isChuangxiangVideoConnection, chuangxiangVideoModel, chuangxiangVideoTransport,
  validateChuangxiangVideoRequest, normalizeChuangxiangVideoParameters, CHUANGXIANG_VIDEO_POLL_INTERVAL_MS } from "./chuangxiang-video-contract.js";
import { getImageEditingCapabilities, imageEditingConnection, imageEditingRequestIssues,
  imageReferenceAssets, normalizeImageEditingParameters } from "./image-editing-capabilities.js";
import { verifiedTransparentImageEvidence, verifiedTransparentImageJsonEndpoint } from "./transparent-image-evidence.js";
import {
  assertValidResult,
  getProviderTaskId,
  withCanonicalModelFields,
} from "./contracts.js";
import {
  assetAsUrl,
  assetToBlob,
  fetchProviderJson,
  fetchProviderBytes,
  mergeHeaders,
  providerFetch,
  providerSubmitTransportActive,
  ProviderHttpError,
  type ProviderFetchOptions,
  requireApiKey,
} from "./http.js";
import {
  cloneJsonValue,
  readJsonPath,
  setJsonPointer,
} from "./json-mapping.js";

export type RestSource =
  | { kind: "request"; path: string }
  | { kind: "task"; path: string }
  | {
      kind: "assets";
      assetKind?: ProviderAssetInput["kind"];
      role?: ProviderAssetInput["role"];
      excludeRoles?: readonly NonNullable<ProviderAssetInput["role"]>[];
      select?: "all" | "first" | "firstIfOnly" | "allIfMultiple" | "firstOrAll";
      /** Skip the first N matching assets before applying `select`. */
      offset?: number;
      /** Optional provider-native JSON encoding for selected assets. */
      encoding?: "default" | "gemini-part" | "gemini-inline-part";
    }
  | {
      /** Build one OpenAI-style user message from the prompt and input images. */
      kind: "openaiMessages";
      detail?: "auto" | "low" | "high";
      /** Include source-video links in the text prompt, without typed parts. */
      videoReferenceEncoding?: "prompt-urls";
    }
  | {
      /** Derive the standard WxH string from video resolution and orientation. */
      kind: "videoDimensions";
      resolutionPath: string;
      aspectRatioPath: string;
    }
  | {
      kind: "assetMode";
      frameValue: string;
      referenceValue: string;
      /** Use referenceValue only when at least this many images are supplied. */
      referenceThreshold?: number;
    }
  | { kind: "literal"; value: unknown };

export interface RestRequestMapping {
  /** RFC 6901 pointer within the outbound request body. */
  target: string;
  source: RestSource;
  omitIfUndefined?: boolean;
  omitIfEmpty?: boolean;
  /** Primitive sentinel values that should be omitted instead of sent upstream. */
  omitValues?: readonly (string | number | boolean | null)[];
  /** Optional primitive coercion applied after the source value is resolved. */
  coerce?: "string" | "number" | "boolean";
  /** Send this mapping only when every request JSONPath matches its enum. */
  when?: readonly { path: string; values: readonly (string | number | boolean | null)[] }[];
}

export interface RestResponseMapping {
  taskIdPath?: string;
  taskIdFallbackPaths?: readonly string[];
  statusPath?: string;
  statusFallbackPaths?: readonly string[];
  errorPath?: string;
  errorFallbackPaths?: readonly string[];
  progressPath?: string;
}

export interface RestRequestDefinition {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  bodyMode?: "none" | "json" | "multipart";
  template?: unknown;
  mappings?: readonly RestRequestMapping[];
  headers?: Readonly<Record<string, string>>;
  response?: RestResponseMapping;
  /** True only if the remote endpoint honors the configured idempotency key. */
  idempotent?: boolean;
}

export interface RestOutputMapping {
  /** JSONPath selecting one output or an array of outputs. */
  path: string;
  /** Alternative JSONPaths used when providers vary their completed payload shape. */
  fallbackPaths?: readonly string[];
  kind: ArtifactKind;
  /** Media-bearing chat content: Markdown, typed parts, absolute URLs and data URIs. */
  format?: "openai-chat-images" | "openai-chat-videos";
  /** Reject terminal success without output instead of accepting an empty paid response. */
  requireOutput?: boolean;
  /** Relative JSONPaths used when selected outputs are objects. */
  urlPath?: string;
  /** Alternative relative JSONPaths for URL-shaped provider variants. */
  urlFallbackPaths?: readonly string[];
  base64Path?: string;
  /** Alternative relative JSONPaths for base64-shaped provider variants. */
  base64FallbackPaths?: readonly string[];
  mimeTypePath?: string;
  filenamePath?: string;
  defaultMimeType?: string;
  /** Authenticated same-origin task content, used only after a terminal success. */
  contentFallback?: { path: string; alternatePaths?: readonly string[] };
}

export interface RestAuthConfig {
  type: "none" | "bearer" | "header";
  headerName?: string;
  prefix?: string;
}

export interface RestWebhookConfig {
  /** Header containing an HMAC-SHA256 signature of the raw request body. */
  signatureHeader?: string;
  /** Optional prefix removed before comparing the signature (for example `sha256=`). */
  signaturePrefix?: string;
  taskIdPath: string;
  statusPath?: string;
  errorPath?: string;
  progressPath?: string;
}

export interface RestConnectorConfig {
  submit: RestRequestDefinition;
  poll?: RestRequestDefinition;
  cancel?: RestRequestDefinition;
  test?: RestRequestDefinition;
  auth?: RestAuthConfig;
  models?: readonly ModelDescriptor[];
  /** Reject model IDs not present in models; useful for group-scoped catalogs. */
  restrictModels?: boolean;
  output: RestOutputMapping;
  statusMap?: Readonly<Record<string, ProviderTaskStatus>>;
  pollIntervalMs?: number;
  /** Absolute request URLs must match this exact hostname list. */
  allowedHosts?: readonly string[];
  /** Convert canvas inputs to short-lived public http(s) URLs before submit. */
  assetsRequirePublicUrls?: boolean;
  allowInsecureHttp?: boolean;
  webhook?: RestWebhookConfig;
  /** Transport differences for model families sharing one connection. */
  modelOverrides?: Readonly<Record<string, RestModelConnectorOverride>>;
  /** Transport differences between generate/edit operations sharing a model. */
  operationOverrides?: Partial<
    Readonly<Record<ProviderOperation, RestModelConnectorOverride>>
  >;
}

export interface RestModelConnectorOverride {
  auth?: RestAuthConfig;
  submit?: RestRequestDefinition;
  poll?: RestRequestDefinition;
  cancel?: RestRequestDefinition;
  output?: RestOutputMapping;
  statusMap?: Readonly<Record<string, ProviderTaskStatus>>;
  pollIntervalMs?: number;
  /** Model-specific transport differences between generate/edit operations. */
  operationOverrides?: Partial<
    Readonly<Record<ProviderOperation, RestModelConnectorOverride>>
  >;
}

interface RestTaskEnvelope {
  connectionId: string;
  config: RestConnectorConfig;
  remote: unknown;
  baseUrl?: string;
  taskId?: string;
  status?: ProviderTaskStatus;
  model?: string;
  videoOutputParameters?: Record<string, unknown>;
}

/** The selected request, not a mixed group's blanket flag, decides transport. */
export function restRequestRequiresPublicAssets(value: unknown, model?: string, operation?: ProviderOperation, settings?: unknown): boolean {
  if (operation?.startsWith("video.") && isRecord(settings) && isChuangxiangVideoConnection(settings, model)) return true;
  if (operation?.startsWith("image.") && isRecord(settings) &&
    canApplyCangyuanCurrentContract(settings, typeof settings.baseUrl === "string" ? settings.baseUrl : undefined, model)) return !/^grok-imagine-image(?:-2\.0)?$/u.test(model ?? "");
  if (!isRecord(value) || value.assetsRequirePublicUrls !== true) return false;
  const config = value as unknown as RestConnectorConfig;
  const modelOverride = model ? config.modelOverrides?.[model] : undefined;
  const submit = (operation ? modelOverride?.operationOverrides?.[operation]?.submit : undefined)
    ?? (operation ? config.operationOverrides?.[operation]?.submit : undefined)
    ?? modelOverride?.submit ?? config.submit;
  const assets = submit?.mappings?.filter(mapping => mapping.source.kind === "assets") ?? [];
  if (assets.length > 0 && submit.bodyMode === "multipart") return false;
  if (assets.length > 0 && submit.bodyMode === "json" && assets.every(mapping =>
    mapping.source.kind === "assets" && ["gemini-part", "gemini-inline-part"].includes(mapping.source.encoding ?? ""))) return false;
  return true;
}

export interface GenericRestAdapterOptions {
  fetch?: FetchImplementation;
  requestTimeoutMs?: number;
  /** Optional fixed config; otherwise connection.settings.connector is used. */
  config?: RestConnectorConfig;
}

const IMAGE_JSON_ENVELOPE_BYTES = 2 * 1024 * 1024;
const IMAGE_JSON_BYTES_PER_BASE64_OUTPUT = 48 * 1024 * 1024;

function imageJsonMaxResponseBytes(
  config: RestConnectorConfig,
  parameters: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  const returnsBase64 = Boolean(
    config.output.base64Path || config.output.base64FallbackPaths?.length,
  );
  if (config.output.kind !== "image" || !returnsBase64) return undefined;
  const requested = parameters?.["n"];
  const count =
    typeof requested === "number" &&
    Number.isSafeInteger(requested) &&
    requested >= 1 &&
    requested <= 10
      ? requested
      : 1;
  return IMAGE_JSON_ENVELOPE_BYTES + IMAGE_JSON_BYTES_PER_BASE64_OUTPUT * count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeAsset(value: unknown): value is ProviderAssetInput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "image" ||
      value.kind === "video" ||
      value.kind === "audio") &&
    typeof value.mimeType === "string"
  );
}

function jsonBodyValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("base64");
  }
  if (looksLikeAsset(value)) {
    const encoded = assetAsUrl(value);
    if (!encoded)
      throw new Error(`Asset ${value.id} has neither bytes nor a URL`);
    return encoded;
  }
  if (typeof value !== "object" || value === null) {
    if (typeof value === "bigint") {
      throw new Error(
        "REST connector JSON bodies cannot contain bigint values",
      );
    }
    return value;
  }
  if (ancestors.has(value)) {
    throw new Error(
      "REST connector JSON bodies cannot contain circular values",
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => jsonBodyValue(item, ancestors));
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonBodyValue(item, ancestors),
      ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function assertRequestDefinition(
  value: unknown,
  label: string,
): asserts value is RestRequestDefinition {
  if (!isRecord(value) || typeof value.path !== "string") {
    throw new Error(`${label} must define a request path`);
  }
  if (
    value.bodyMode !== undefined &&
    value.bodyMode !== "none" &&
    value.bodyMode !== "json" &&
    value.bodyMode !== "multipart"
  ) {
    throw new Error(`${label}.bodyMode is invalid`);
  }
  if (value.mappings !== undefined && !Array.isArray(value.mappings)) {
    throw new Error(`${label}.mappings must be an array`);
  }
  for (const [index, mapping] of (value.mappings ?? []).entries()) {
    if (
      !isRecord(mapping) ||
      typeof mapping.target !== "string" ||
      !mapping.target.startsWith("/")
    ) {
      throw new Error(
        `${label}.mappings[${index}].target must be a JSON Pointer`,
      );
    }
    if (!isRecord(mapping.source) || typeof mapping.source.kind !== "string") {
      throw new Error(`${label}.mappings[${index}].source is invalid`);
    }
    for (const key of ["omitIfUndefined", "omitIfEmpty"] as const) {
      if (mapping[key] !== undefined && typeof mapping[key] !== "boolean") {
        throw new Error(`${label}.mappings[${index}].${key} must be boolean`);
      }
    }
    if (mapping.when !== undefined) {
      if (!Array.isArray(mapping.when) || mapping.when.length === 0) throw new Error(`${label}.mappings[${index}].when must be a nonempty array`);
      for (const condition of mapping.when) {
        if (!isRecord(condition) || typeof condition.path !== "string" || !condition.path.startsWith("$") ||
          !Array.isArray(condition.values) || condition.values.length === 0 || condition.values.some(item =>
            item !== null && typeof item !== "string" && typeof item !== "boolean" && (typeof item !== "number" || !Number.isFinite(item))))
          throw new Error(`${label}.mappings[${index}].when must contain JSONPath and primitive enum values`);
        readJsonPath(undefined, condition.path);
      }
    }
    if (
      mapping.omitValues !== undefined &&
      (!Array.isArray(mapping.omitValues) ||
        mapping.omitValues.some(
          (item) =>
            item !== null &&
            typeof item !== "string" &&
            typeof item !== "boolean" &&
            (typeof item !== "number" || !Number.isFinite(item)),
        ))
    ) {
      throw new Error(
        `${label}.mappings[${index}].omitValues must contain only JSON primitive values`,
      );
    }
    if (mapping.source.kind === "request" || mapping.source.kind === "task") {
      if (
        typeof mapping.source.path !== "string" ||
        !mapping.source.path.startsWith("$")
      ) {
        throw new Error(
          `${label}.mappings[${index}].source.path must be a JSONPath`,
        );
      }
    } else if (mapping.source.kind === "assets") {
      if (
        mapping.source.assetKind !== undefined &&
        mapping.source.assetKind !== "image" &&
        mapping.source.assetKind !== "video" &&
        mapping.source.assetKind !== "audio"
      ) {
        throw new Error(
          `${label}.mappings[${index}].source.assetKind is invalid`,
        );
      }
      if (
        mapping.source.select !== undefined &&
        mapping.source.select !== "all" &&
        mapping.source.select !== "first" &&
        mapping.source.select !== "firstIfOnly" &&
        mapping.source.select !== "allIfMultiple" &&
        mapping.source.select !== "firstOrAll"
      ) {
        throw new Error(`${label}.mappings[${index}].source.select is invalid`);
      }
      if (
        mapping.source.offset !== undefined &&
        (typeof mapping.source.offset !== "number" ||
          !Number.isSafeInteger(mapping.source.offset) ||
          mapping.source.offset < 0)
      ) {
        throw new Error(
          `${label}.mappings[${index}].source.offset must be a non-negative integer`,
        );
      }
      if (
        mapping.source.excludeRoles !== undefined &&
        !Array.isArray(mapping.source.excludeRoles)
      ) {
        throw new Error(
          `${label}.mappings[${index}].source.excludeRoles must be an array`,
        );
      }
      if (
        mapping.source.encoding !== undefined &&
        mapping.source.encoding !== "default" &&
        mapping.source.encoding !== "gemini-part" && mapping.source.encoding !== "gemini-inline-part"
      ) {
        throw new Error(
          `${label}.mappings[${index}].source.encoding is invalid`,
        );
      }
    } else if (mapping.source.kind === "assetMode") {
      if (
        typeof mapping.source.frameValue !== "string" ||
        typeof mapping.source.referenceValue !== "string"
      ) {
        throw new Error(
          `${label}.mappings[${index}].source asset mode values must be strings`,
        );
      }
      if (
        mapping.source.referenceThreshold !== undefined &&
        (typeof mapping.source.referenceThreshold !== "number" ||
          !Number.isInteger(mapping.source.referenceThreshold) ||
          mapping.source.referenceThreshold < 1)
      ) {
        throw new Error(
          `${label}.mappings[${index}].source.referenceThreshold must be a positive integer`,
        );
      }
    } else if (mapping.source.kind === "openaiMessages") {
      if (
        mapping.source.detail !== undefined &&
        mapping.source.detail !== "auto" &&
        mapping.source.detail !== "low" &&
        mapping.source.detail !== "high"
      ) {
        throw new Error(`${label}.mappings[${index}].source.detail is invalid`);
      }
      if (mapping.source.videoReferenceEncoding !== undefined && mapping.source.videoReferenceEncoding !== "prompt-urls")
        throw new Error(`${label}.mappings[${index}].source.videoReferenceEncoding is invalid`);
    } else if (mapping.source.kind === "videoDimensions") {
      for (const key of ["resolutionPath", "aspectRatioPath"] as const) {
        if (
          typeof mapping.source[key] !== "string" ||
          !mapping.source[key].startsWith("$")
        ) {
          throw new Error(
            `${label}.mappings[${index}].source.${key} must be a JSONPath`,
          );
        }
      }
    } else if (mapping.source.kind === "literal") {
      if (!Object.hasOwn(mapping.source, "value")) {
        throw new Error(
          `${label}.mappings[${index}].literal source needs a value`,
        );
      }
    } else {
      throw new Error(`${label}.mappings[${index}].source.kind is invalid`);
    }
    if (
      mapping.coerce !== undefined &&
      mapping.coerce !== "string" &&
      mapping.coerce !== "number" &&
      mapping.coerce !== "boolean"
    ) {
      throw new Error(`${label}.mappings[${index}].coerce is invalid`);
    }
  }
  if (value.response !== undefined && !isRecord(value.response)) {
    throw new Error(`${label}.response must be an object`);
  }
  for (const key of [
    "taskIdPath",
    "statusPath",
    "errorPath",
    "progressPath",
  ] as const) {
    if (
      value.response !== undefined &&
      value.response[key] !== undefined &&
      typeof value.response[key] !== "string"
    ) {
      throw new Error(`${label}.response.${key} must be a JSONPath`);
    }
  }
  if (
    value.response !== undefined &&
    value.response.taskIdFallbackPaths !== undefined &&
    (!Array.isArray(value.response.taskIdFallbackPaths) ||
      value.response.taskIdFallbackPaths.some(
        (path) => typeof path !== "string",
      ))
  ) {
    throw new Error(`${label}.response.taskIdFallbackPaths must be JSONPaths`);
  }
  if (
    value.response !== undefined &&
    value.response.errorFallbackPaths !== undefined &&
    (!Array.isArray(value.response.errorFallbackPaths) ||
      value.response.errorFallbackPaths.some(
        (path) => typeof path !== "string",
      ))
  ) {
    throw new Error(`${label}.response.errorFallbackPaths must be JSONPaths`);
  }
  if (
    value.response !== undefined &&
    value.response.statusFallbackPaths !== undefined &&
    (!Array.isArray(value.response.statusFallbackPaths) ||
      value.response.statusFallbackPaths.some(
        (path) => typeof path !== "string",
      ))
  ) {
    throw new Error(`${label}.response.statusFallbackPaths must be JSONPaths`);
  }
}

function assertConfig(value: unknown): asserts value is RestConnectorConfig {
  if (!isRecord(value))
    throw new Error("REST connector configuration is missing");
  assertRequestDefinition(value.submit, "submit");
  if (value.poll !== undefined) assertRequestDefinition(value.poll, "poll");
  if (value.cancel !== undefined)
    assertRequestDefinition(value.cancel, "cancel");
  if (value.test !== undefined) assertRequestDefinition(value.test, "test");
  if (!isRecord(value.output) || typeof value.output.path !== "string") {
    throw new Error("REST connector output.path is required");
  }
  if (
    value.output.fallbackPaths !== undefined &&
    (!Array.isArray(value.output.fallbackPaths) ||
      value.output.fallbackPaths.some((path) => typeof path !== "string"))
  ) {
    throw new Error("REST connector output.fallbackPaths must be JSONPaths");
  }
  for (const key of ["urlFallbackPaths", "base64FallbackPaths"] as const) {
    if (
      value.output[key] !== undefined &&
      (!Array.isArray(value.output[key]) ||
        value.output[key].some((path) => typeof path !== "string"))
    ) {
      throw new Error(`REST connector output.${key} must be JSONPaths`);
    }
  }
  if (value.output.kind !== "image" && value.output.kind !== "video" && value.output.kind !== "audio") {
    throw new Error("REST connector output.kind must be image, video or audio");
  }
  if (value.output.format !== undefined && !((value.output.format === "openai-chat-images" && value.output.kind === "image") ||
      (value.output.format === "openai-chat-videos" && value.output.kind === "video")))
    throw new Error("REST connector output.format must match the declared image or video kind");
  if (value.output.requireOutput !== undefined && typeof value.output.requireOutput !== "boolean")
    throw new Error("REST connector output.requireOutput must be boolean");
  if (value.output.contentFallback !== undefined) {
    const fallback = value.output.contentFallback;
    if (!isRecord(fallback) || typeof fallback.path !== "string" ||
      (fallback.alternatePaths !== undefined && (!Array.isArray(fallback.alternatePaths) ||
        fallback.alternatePaths.some(path => typeof path !== "string"))))
      throw new Error("REST connector output.contentFallback must define task content paths");
    for (const path of [fallback.path, ...(fallback.alternatePaths as string[] | undefined ?? [])]) {
      if (!/^\/(?!\/)/u.test(path) || !path.includes("{taskId}") || /[?#\\]/u.test(path))
        throw new Error("REST task content paths must be relative and contain {taskId}");
    }
  }
  for (const key of [
    "urlPath",
    "base64Path",
    "mimeTypePath",
    "filenamePath",
    "defaultMimeType",
  ] as const) {
    if (
      value.output[key] !== undefined &&
      typeof value.output[key] !== "string"
    ) {
      throw new Error(`REST connector output.${key} must be a string`);
    }
  }
  if (value.auth !== undefined) {
    if (
      !isRecord(value.auth) ||
      !["none", "bearer", "header"].includes(value.auth.type as string)
    ) {
      throw new Error("REST connector auth.type is invalid");
    }
    if (
      value.auth.type === "header" &&
      value.auth.headerName !== undefined &&
      typeof value.auth.headerName !== "string"
    ) {
      throw new Error("REST connector auth.headerName must be a string");
    }
  }
  if (value.webhook !== undefined) {
    if (
      !isRecord(value.webhook) ||
      typeof value.webhook.taskIdPath !== "string"
    )
      throw new Error("REST connector webhook.taskIdPath is required");
    for (const key of [
      "signatureHeader",
      "signaturePrefix",
      "statusPath",
      "errorPath",
      "progressPath",
    ] as const) {
      if (
        value.webhook[key] !== undefined &&
        typeof value.webhook[key] !== "string"
      )
        throw new Error(`REST connector webhook.${key} must be a string`);
    }
  }
  if (
    value.allowedHosts !== undefined &&
    (!Array.isArray(value.allowedHosts) ||
      value.allowedHosts.some((host) => typeof host !== "string"))
  ) {
    throw new Error("REST connector allowedHosts must be an array of strings");
  }
  if (
    value.assetsRequirePublicUrls !== undefined &&
    typeof value.assetsRequirePublicUrls !== "boolean"
  ) {
    throw new Error("REST connector assetsRequirePublicUrls must be boolean");
  }
  if (
    value.pollIntervalMs !== undefined &&
    (typeof value.pollIntervalMs !== "number" ||
      !Number.isInteger(value.pollIntervalMs) ||
      value.pollIntervalMs < 250 ||
      value.pollIntervalMs > 60_000)
  ) {
    throw new Error(
      "REST connector pollIntervalMs must be an integer from 250 to 60000",
    );
  }
  if (
    value.restrictModels !== undefined &&
    typeof value.restrictModels !== "boolean"
  ) {
    throw new Error("REST connector restrictModels must be a boolean");
  }
  if (value.modelOverrides !== undefined) {
    if (!isRecord(value.modelOverrides))
      throw new Error("REST connector modelOverrides must be an object");
    for (const [model, override] of Object.entries(value.modelOverrides)) {
      if (!isRecord(override))
        throw new Error(`REST connector modelOverrides.${model} is invalid`);
      if (override.submit !== undefined)
        assertRequestDefinition(
          override.submit,
          `modelOverrides.${model}.submit`,
        );
      if (override.poll !== undefined)
        assertRequestDefinition(override.poll, `modelOverrides.${model}.poll`);
      if (override.cancel !== undefined)
        assertRequestDefinition(
          override.cancel,
          `modelOverrides.${model}.cancel`,
        );
      if (
        override.output !== undefined &&
        (!isRecord(override.output) ||
          typeof override.output.path !== "string" ||
          (override.output.kind !== "image" &&
            override.output.kind !== "video" && override.output.kind !== "audio"))
      ) {
        throw new Error(
          `REST connector modelOverrides.${model}.output is invalid`,
        );
      }
      if (override.operationOverrides !== undefined) {
        assertOperationOverrides(
          override.operationOverrides,
          `modelOverrides.${model}.operationOverrides`,
        );
      }
    }
  }
  if (value.operationOverrides !== undefined) {
    assertOperationOverrides(value.operationOverrides, "operationOverrides");
  }
}

function assertOperationOverrides(
  value: unknown,
  label: string,
): asserts value is Partial<
  Readonly<Record<ProviderOperation, RestModelConnectorOverride>>
> {
  if (!isRecord(value))
    throw new Error(`REST connector ${label} must be an object`);
  const operations = new Set<ProviderOperation>([
    "image.generate",
    "image.edit",
    "video.generate",
    "video.image-to-video",
    "music.generate",
  ]);
  for (const [operation, override] of Object.entries(value)) {
    if (!operations.has(operation as ProviderOperation) || !isRecord(override))
      throw new Error(`REST connector ${label}.${operation} is invalid`);
    if (override.submit !== undefined)
      assertRequestDefinition(override.submit, `${label}.${operation}.submit`);
    if (override.poll !== undefined)
      assertRequestDefinition(override.poll, `${label}.${operation}.poll`);
    if (override.cancel !== undefined)
      assertRequestDefinition(override.cancel, `${label}.${operation}.cancel`);
    if (
      override.output !== undefined &&
      (!isRecord(override.output) ||
        typeof override.output.path !== "string" ||
        (override.output.kind !== "image" && override.output.kind !== "video" && override.output.kind !== "audio"))
    )
      throw new Error(`REST connector ${label}.${operation}.output is invalid`);
  }
}

function envelopeFrom(task: ProviderTask): RestTaskEnvelope {
  if (
    !isRecord(task.result) ||
    typeof task.result.connectionId !== "string" ||
    !isRecord(task.result.config)
  ) {
    throw new Error("REST task is missing connector state");
  }
  assertConfig(task.result.config);
  return task.result as unknown as RestTaskEnvelope;
}

function sourceValue(
  source: RestSource,
  request: NormalizedRequest | undefined,
  task: ProviderTask | undefined,
): unknown {
  if (source.kind === "literal") return cloneJsonValue(source.value);
  if (source.kind === "assets") {
    const assets = (request?.assets ?? []).filter(
      (asset) =>
        (source.assetKind === undefined || asset.kind === source.assetKind) &&
        (asset.role !== "mask" || source.role === "mask") &&
        (source.role === undefined || asset.role === source.role) &&
        !(source.excludeRoles ?? []).includes(asset.role ?? "reference"),
    );
    const selectedAssets =
      source.offset === undefined ? assets : assets.slice(source.offset);
    const encode = (asset: ProviderAssetInput): unknown => {
      if (source.encoding !== "gemini-part" && source.encoding !== "gemini-inline-part") return asset;
      const camelCase = source.encoding === "gemini-inline-part";
      if (asset.data) {
        if (camelCase) return { inlineData: { mimeType: asset.mimeType, data: Buffer.from(asset.data).toString("base64") } };
        return {
          inline_data: {
            mime_type: asset.mimeType,
            data: Buffer.from(asset.data).toString("base64"),
          },
        };
      }
      const encoded = assetAsUrl(asset);
      if (!encoded)
        throw new Error(`Asset ${asset.id} has neither bytes nor a URL`);
      const dataUri = /^data:([^;,]+);base64,(.+)$/su.exec(encoded);
      if (dataUri) {
        if (camelCase) return { inlineData: { mimeType: dataUri[1] || asset.mimeType, data: dataUri[2] } };
        return {
          inline_data: {
            mime_type: dataUri[1] || asset.mimeType,
            data: dataUri[2],
          },
        };
      }
      if (camelCase) return { fileData: { mimeType: asset.mimeType, fileUri: encoded } };
      return {
        file_data: {
          mime_type: asset.mimeType,
          file_uri: encoded,
        },
      };
    };
    if (source.select === "first")
      return selectedAssets[0] ? encode(selectedAssets[0]) : undefined;
    if (source.select === "firstIfOnly")
      return selectedAssets.length === 1 ? encode(selectedAssets[0]!) : undefined;
    if (source.select === "allIfMultiple")
      return selectedAssets.length > 1 ? selectedAssets.map(encode) : undefined;
    if (source.select === "firstOrAll")
      return selectedAssets.length === 1
        ? encode(selectedAssets[0]!)
        : selectedAssets.length > 1
          ? selectedAssets.map(encode)
          : undefined;
    return selectedAssets.map(encode);
  }
  if (source.kind === "assetMode") {
    const assets = imageReferenceAssets(request?.assets);
    const hasFrame = assets.some(
      (asset) => asset.role === "firstFrame" || asset.role === "lastFrame",
    );
    if (hasFrame) return source.frameValue;
    if (source.referenceThreshold !== undefined) {
      const imageCount = assets.filter(
        (asset) => asset.kind === "image",
      ).length;
      return imageCount >= source.referenceThreshold
        ? source.referenceValue
        : source.frameValue;
    }
    return source.referenceValue;
  }
  if (source.kind === "openaiMessages") {
    const videoUrls = source.videoReferenceEncoding === "prompt-urls"
      ? (request?.assets ?? []).filter(asset => asset.kind === "video").map(asset => {
          if (!isRemainingVideoPublicHttpsUrl(asset.url)) throw new Error(`Video asset ${asset.id} requires a public HTTPS URL`);
          return asset.url;
        }) : [];
    const prompt = [request?.prompt ?? "", ...videoUrls.map((url, index) => `参考视频 ${index + 1}: ${url}`)].join("\n");
    const images = imageReferenceAssets(request?.assets).filter(
      (asset) => asset.kind === "image",
    );
    if (images.length === 0) return [{ role: "user", content: prompt }];
    return [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((asset) => {
            const url = assetAsUrl(asset);
            if (!url)
              throw new Error(`Asset ${asset.id} has neither bytes nor a URL`);
            return {
              type: "image_url",
              image_url: { url, detail: source.detail ?? "high" },
            };
          }),
        ],
      },
    ];
  }
  if (source.kind === "videoDimensions") {
    const resolution = request
      ? readJsonPath(request, source.resolutionPath)
      : undefined;
    const aspectRatio = request
      ? readJsonPath(request, source.aspectRatioPath)
      : undefined;
    const sizes: Readonly<Record<string, Readonly<Record<string, string>>>> = {
      "720p": { "16:9": "1280x720", "9:16": "720x1280" },
      "1080p": { "16:9": "1920x1080", "9:16": "1080x1920" },
    };
    return typeof resolution === "string" && typeof aspectRatio === "string"
      ? sizes[resolution]?.[aspectRatio]
      : undefined;
  }
  if (source.kind === "request")
    return request ? readJsonPath(request, source.path) : undefined;
  return task ? readJsonPath(task, source.path) : undefined;
}

function coerceMappingValue(
  value: unknown,
  coerce: RestRequestMapping["coerce"],
): unknown {
  if (value === undefined || coerce === undefined) return value;
  if (coerce === "string") return String(value);
  if (coerce === "number") return Number(value);
  return Boolean(value);
}

function normalizeStatus(
  raw: unknown,
  config: RestConnectorConfig,
  fallback: ProviderTaskStatus,
): ProviderTaskStatus {
  if (typeof raw !== "string") return fallback;
  const mapped =
    config.statusMap?.[raw] ??
    config.statusMap?.[raw.toUpperCase()] ??
    Object.entries(config.statusMap ?? {}).find(
      ([key]) => key.toUpperCase() === raw.toUpperCase(),
    )?.[1];
  if (mapped) return mapped;
  switch (raw.toUpperCase()) {
    case "QUEUED":
    case "PENDING":
    case "SUBMITTED":
      return "queued";
    case "RUNNING":
    case "PROCESSING":
    case "IN_PROGRESS":
      return "running";
    case "SUCCEEDED":
    case "SUCCESS":
    case "COMPLETED":
    case "DONE":
      return "succeeded";
    case "FAILED":
    case "ERROR":
      return "failed";
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    default:
      return fallback;
  }
}

function responseValue(
  payload: unknown,
  primaryPath: string | undefined,
  fallbackPaths: readonly string[] = [],
): unknown {
  for (const path of primaryPath
    ? [primaryPath, ...fallbackPaths]
    : fallbackPaths) {
    const value = readJsonPath(payload, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function normalizeProgress(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim().endsWith("%")) {
    const percent = Number(value.trim().slice(0, -1));
    return Number.isFinite(percent)
      ? Math.max(0, Math.min(1, percent / 100))
      : undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const normalized = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  return Math.max(0, Math.min(1, normalized));
}

function numericAspectRatio(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:：/／]\s*(\d+(?:\.\d+)?)\s*$/u.exec(
    value,
  );
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return undefined;
  return width / height;
}

/** Snap a prompt/reference-derived ratio to the selected model's API enum. */
function withNearestSupportedAspectRatio(
  request: NormalizedRequest,
  config: RestConnectorConfig,
): NormalizedRequest {
  const requested = request.parameters?.["aspect_ratio"];
  const requestedRatio = numericAspectRatio(requested);
  if (requestedRatio === undefined) return request;
  const model = config.models?.find(
    (candidate) => candidate.id === request.model,
  );
  const descriptor = model?.parameters?.find(
    (parameter) =>
      parameter.key === "aspect_ratio" &&
      (!parameter.operations ||
        parameter.operations.includes(request.operation)),
  );
  const candidates = (descriptor?.options ?? []).flatMap((option) => {
    const ratio = numericAspectRatio(option.value);
    return typeof option.value === "string" && ratio !== undefined
      ? [{ value: option.value, ratio }]
      : [];
  });
  if (candidates.length === 0) return request;
  const nearest = candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.ratio / requestedRatio));
    const candidateDistance = Math.abs(
      Math.log(candidate.ratio / requestedRatio),
    );
    return candidateDistance < bestDistance ? candidate : best;
  });
  if (nearest.value === requested) return request;
  return {
    ...request,
    parameters: { ...request.parameters, aspect_ratio: nearest.value },
  };
}

function relativePath(root: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  return readJsonPath(root, path.startsWith("$") ? path : `$.${path}`);
}

function validatePath(path: string | undefined, relative = false): void {
  if (path !== undefined) {
    readJsonPath(
      undefined,
      relative && !path.startsWith("$") ? `$.${path}` : path,
    );
  }
}

export class GenericRestAdapter implements ProviderAdapter {
  private readonly fetchImpl: FetchImplementation;
  private readonly requestTimeoutMs: number;
  private readonly imageSubmitTimeoutMs: number;
  private readonly fixedConfig: RestConnectorConfig | undefined;

  public constructor(
    private readonly connections: ProviderConnectionResolver,
    options: GenericRestAdapterOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? providerFetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.imageSubmitTimeoutMs = options.requestTimeoutMs ?? 0;
    this.fixedConfig = options.config;
  }

  private configFrom(
    connection: Awaited<ReturnType<ProviderConnectionResolver["resolve"]>>,
    model?: string,
    operation?: ProviderOperation,
    assets?: readonly ProviderAssetInput[],
  ): RestConnectorConfig {
    const value = this.fixedConfig ?? connection.settings?.["connector"];
    assertConfig(value);
    const base = cloneJsonValue(value);
    const applyOverride = (
      config: RestConnectorConfig,
      override: RestModelConnectorOverride | undefined,
    ): RestConnectorConfig =>
      override
        ? {
            ...config,
            ...(override.auth ? { auth: override.auth } : {}),
            ...(override.submit ? { submit: override.submit } : {}),
            ...(override.poll ? { poll: override.poll } : {}),
            ...(override.cancel ? { cancel: override.cancel } : {}),
            ...(override.output ? { output: override.output } : {}),
            ...(override.statusMap ? { statusMap: override.statusMap } : {}),
            ...(override.pollIntervalMs !== undefined
              ? { pollIntervalMs: override.pollIntervalMs }
              : {}),
          }
        : config;
    const modelConfig = applyOverride(
      base,
      model ? base.modelOverrides?.[model] : undefined,
    );
    const operationConfig = applyOverride(
      modelConfig,
      operation ? base.operationOverrides?.[operation] : undefined,
    );
    const modelOperationOverride =
      model && operation
        ? base.modelOverrides?.[model]?.operationOverrides?.[operation]
        : undefined;
    const selected = applyOverride(operationConfig, modelOperationOverride);
    assertConfig(selected);
    if (!this.fixedConfig && isCangyuanMusicRequest(model, connection.baseUrl)) {
      return { ...applyOverride(selected, cangyuanMusicTransport(undefined, model)), assetsRequirePublicUrls: false };
    }
    if (!this.fixedConfig && isCangyuanVideoRequest(model, connection.baseUrl))
      return { ...applyOverride(selected, cangyuanVideoTransport(model!)), assetsRequirePublicUrls: true };
    if (["rest", "openai"].includes(connection.provider) && isChuangxiangVideoConnection(imageEditingConnection(connection).config, model))
      return { ...applyOverride(selected, chuangxiangVideoTransport()), assetsRequirePublicUrls: true };
    const remainingSupplier = remainingVideoSupplier(connection.baseUrl);
    const videoContext = remainingVideoContext(connection.settings, base.models?.find(m => m.id === model), assets);
    if (!this.fixedConfig && remainingSupplier && isRemainingVideoModel(remainingSupplier, model, videoContext) &&
        !preservesMiaowuExplicitVideoContract(imageEditingConnection(connection).config, videoContext.model, operation))
      return { ...applyOverride(selected, remainingVideoTransport(remainingSupplier, model!, videoContext)), assetsRequirePublicUrls: remainingVideoRequiresPublicUrls(remainingSupplier, model!, videoContext) };
    // Repair stale family-inherited mappings for these exact public IDs only.
    // Model restrictions and credentials remain owned by the saved connection.
    if (!this.fixedConfig && managesCangyuanCurrentTransport(connection.settings ?? {}, connection.baseUrl, base, model)) {
      const current = cangyuanCurrentTransport(model!)!;
      return { ...applyOverride(applyOverride(selected, current), operation ? current.operationOverrides?.[operation] : undefined), assetsRequirePublicUrls: !/^grok-imagine-image(?:-2\.0)?$/u.test(model ?? "") };
    }
    return selected;
  }

  private timeoutFor(
    connection: Awaited<ReturnType<ProviderConnectionResolver["resolve"]>>,
    imageSubmit = false,
  ): number {
    // Marketplace requestTimeoutMs defaults belong to metadata/poll requests;
    // paid image submits only honor an explicitly dedicated image deadline.
    const configured = connection.settings?.[imageSubmit ? "imageSubmitTimeoutMs" : "requestTimeoutMs"];
    return typeof configured === "number" &&
      Number.isFinite(configured) &&
      configured >= 0
      ? configured
      : imageSubmit ? this.imageSubmitTimeoutMs : this.requestTimeoutMs;
  }

  private resolveUrl(
    baseUrl: string | undefined,
    path: string,
    config: RestConnectorConfig,
    taskId?: string,
  ): string {
    const expanded = path.replaceAll(
      "{taskId}",
      encodeURIComponent(taskId ?? ""),
    );
    let url: URL;
    try {
      url = baseUrl
        ? new URL(expanded, `${baseUrl.replace(/\/+$/u, "")}/`)
        : new URL(expanded);
    } catch {
      throw new Error(`Invalid REST connector URL: ${expanded}`);
    }
    if (url.username || url.password) {
      throw new Error(
        "REST connector URLs must not contain embedded credentials",
      );
    }
    if (
      url.protocol !== "https:" &&
      !(config.allowInsecureHttp === true && url.protocol === "http:")
    ) {
      throw new Error(
        "REST connector URLs must use HTTPS unless allowInsecureHttp is enabled",
      );
    }
    const allowedHosts = config.allowedHosts?.map((host) => host.toLowerCase());
    if (allowedHosts && allowedHosts.length > 0) {
      if (!allowedHosts.includes(url.hostname.toLowerCase())) {
        throw new Error(
          `REST connector host is not allowlisted: ${url.hostname}`,
        );
      }
    } else if (baseUrl) {
      const base = new URL(baseUrl);
      if (url.origin !== base.origin) {
        throw new Error(
          "REST connector absolute URL must share the configured base URL origin",
        );
      }
    } else {
      throw new Error(
        "REST connector requires baseUrl or an explicit allowedHosts list",
      );
    }
    return url.toString();
  }

  private headers(
    connection: Awaited<ReturnType<ProviderConnectionResolver["resolve"]>>,
    config: RestConnectorConfig,
    definition: RestRequestDefinition,
    idempotencyKey?: string,
  ): Headers {
    const headers = mergeHeaders(connection.headers, definition.headers);
    const auth = config.auth ?? { type: "bearer" as const };
    if (auth.type === "bearer") {
      headers.set(
        "Authorization",
        `${auth.prefix ?? "Bearer "}${requireApiKey(connection)}`,
      );
    } else if (auth.type === "header") {
      headers.set(
        auth.headerName ?? "X-API-Key",
        `${auth.prefix ?? ""}${requireApiKey(connection)}`,
      );
    }
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    return headers;
  }

  private async buildBody(
    definition: RestRequestDefinition,
    request: NormalizedRequest | undefined,
    task: ProviderTask | undefined,
  ): Promise<BodyInit | undefined> {
    const method = definition.method ?? "POST";
    const mode =
      definition.bodyMode ??
      (method === "GET" || method === "DELETE" ? "none" : "json");
    if (mode === "none") return undefined;
    let value: unknown = cloneJsonValue(definition.template ?? {});
    for (const mapping of definition.mappings ?? []) {
      if (mapping.when && !mapping.when.every(condition => condition.values.some(value => Object.is(value, readJsonPath(request, condition.path))))) continue;
      const mapped = coerceMappingValue(
        sourceValue(mapping.source, request, task),
        mapping.coerce,
      );
      if (mapping.omitValues?.some((value) => Object.is(value, mapped)))
        continue;
      if (mapped === undefined && mapping.omitIfUndefined === true) continue;
      if (
        mapping.omitIfEmpty === true &&
        (mapped === undefined ||
          mapped === null ||
          mapped === "" ||
          (Array.isArray(mapped) && mapped.length === 0))
      )
        continue;
      value = setJsonPointer(value, mapping.target, mapped);
    }
    if (mode === "json") return JSON.stringify(jsonBodyValue(value));
    if (!isRecord(value))
      throw new Error("A multipart REST body must resolve to an object");
    const form = new FormData();
    for (const [name, fieldValue] of Object.entries(value)) {
      await this.appendFormValue(form, name, fieldValue);
    }
    return form;
  }

  private async appendFormValue(
    form: FormData,
    name: string,
    value: unknown,
  ): Promise<void> {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) await this.appendFormValue(form, name, item);
      return;
    }
    if (looksLikeAsset(value)) {
      if (value.data) {
        const blob = await assetToBlob(value, this.fetchImpl);
        form.append(name, blob, value.filename ?? `${value.id}.bin`);
      } else if (value.url) {
        form.append(name, value.url);
      }
      return;
    }
    if (typeof value === "object") {
      form.append(name, JSON.stringify(value));
    } else {
      form.append(name, String(value));
    }
  }

  private async execute(
    connection: Awaited<ReturnType<ProviderConnectionResolver["resolve"]>>,
    config: RestConnectorConfig,
    definition: RestRequestDefinition,
    phase: "connect" | "submit" | "poll" | "cancel",
    request?: NormalizedRequest,
    task?: ProviderTask,
    observeBody?: (body: BodyInit | undefined) => void,
  ): Promise<unknown> {
    let body = await this.buildBody(definition, request, task);
    const taskId = task ? getProviderTaskId(task) : undefined;
    const headers = this.headers(
      connection,
      config,
      definition,
      request?.idempotencyKey,
    );
    const method = definition.method ?? (body === undefined ? "GET" : "POST");
    const bodyMode =
      definition.bodyMode ??
      (method === "GET" || method === "DELETE" ? "none" : "json");
    const endpoint = this.resolveUrl(connection.baseUrl, definition.path, config, taskId);
    if (phase === "submit" && request) body = this.transparentSubmitBody(connection, request, endpoint, method, bodyMode, body);
    observeBody?.(body);
    const maxResponseBytes =
      phase === "submit" || phase === "poll"
        ? imageJsonMaxResponseBytes(config, request?.parameters)
        : undefined;
    if (bodyMode === "json" && body !== undefined) {
      headers.set("content-type", "application/json");
    } else if (bodyMode === "multipart") {
      // Let fetch append the boundary; a caller-supplied JSON content type
      // would make multipart uploads unreadable by most APIs.
      headers.delete("content-type");
    }
    let cloudPolling: ProviderFetchOptions["cloudPolling"];
    if (phase === "submit" && config.poll && providerSubmitTransportActive()) {
      const placeholder = "__SUPER_CANVAS_CLOUD_TASK__";
      if ((config.poll.mappings ?? []).some(mapping => mapping.source.kind !== "literal" &&
        !(mapping.source.kind === "task" && ["$.id", "$.providerTaskId"].includes(mapping.source.path))))
        throw new Error("该接口的查询依赖额外返回字段，暂不支持云端后台，请使用本机方式");
      const pollBody = await this.buildBody(config.poll, undefined, { providerTaskId: placeholder, id: placeholder, status: "running", result: { remote: {} } });
      if (pollBody !== undefined && typeof pollBody !== "string") throw new Error("该接口的查询格式暂不支持云端后台，请使用本机方式");
      const pollHeaders = this.headers(connection, config, config.poll);
      if (pollBody !== undefined) pollHeaders.set("content-type", "application/json");
      cloudPolling = {
        urlTemplate: this.resolveUrl(connection.baseUrl, config.poll.path, config, placeholder),
        method: config.poll.method ?? (pollBody === undefined ? "GET" : "POST"),
        headers: Object.fromEntries(pollHeaders), ...(pollBody === undefined ? {} : { body: pollBody }),
        ...(config.submit.response ? { submitMapping: config.submit.response as Record<string, unknown> } : {}),
        ...(config.poll.response ? { pollMapping: config.poll.response as Record<string, unknown> } : {}),
        ...(config.statusMap ? { statusMap: config.statusMap } : {}),
        ...(config.pollIntervalMs === undefined ? {} : { intervalMs: config.pollIntervalMs }),
      };
    }
    const frozenModel = isRecord(task?.result) && typeof task.result.model === "string" ? task.result.model : undefined;
    const chuangxiangVideo = ["rest", "openai"].includes(connection.provider) && config.output.kind === "video" &&
      isChuangxiangVideoConnection(imageEditingConnection(connection).config, request?.model ?? frozenModel);
    return fetchProviderJson<unknown>(
      this.fetchImpl,
      endpoint,
      {
        method,
        headers,
        redirect: "error",
        ...(body === undefined ? {} : { body }),
      },
      {
        phase,
        timeoutMs: chuangxiangVideo ? phase === "submit" ? 60_000 : 30_000
          : this.timeoutFor(connection, phase === "submit" && request?.operation.startsWith("image.") === true),
        ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
        idempotent: definition.idempotent === true,
        allowEmpty: phase === "cancel",
        ...(cloudPolling ? { cloudPolling } : {}),
      },
    );
  }

  /** Keep the saved submit/poll/output contract; extend only its exact verified JSON body. */
  private transparentSubmitBody(connection: Awaited<ReturnType<ProviderConnectionResolver["resolve"]>>,
    request: NormalizedRequest, endpoint: string, method: string, bodyMode: string, body: BodyInit | undefined): BodyInit | undefined {
    if (request.operation !== "image.generate" || request.parameters?.background !== "transparent") return body;
    const source = imageEditingConnection(connection);
    const evidence = verifiedTransparentImageEvidence(source, request.model ?? "", request.parameters);
    // Dedicated adapters (for example PDog async) retain their own measured transport.
    if (!evidence || evidence.transport.kind !== "saved-rest") return body;
    const verifiedEndpoint = verifiedTransparentImageJsonEndpoint(source, request.model ?? "", request.parameters, evidence, "saved-rest");
    if (!verifiedEndpoint || endpoint !== verifiedEndpoint || method !== "POST" || bodyMode !== "json" || typeof body !== "string")
      throw new Error("已配置的 REST 提交端点或传输与透明证据不一致，当前生成尚未提交");
    const value: unknown = JSON.parse(body);
    if (!isRecord(value) || value.model !== evidence.model)
      throw new Error("已配置的 REST 请求型号与透明证据不一致，当前生成尚未提交");
    return JSON.stringify({ ...value, background: "transparent", output_format: "png" });
  }

  public async testConnection(connectionId: string): Promise<void> {
    const connection = await this.connections.resolve(connectionId);
    const config = this.configFrom(connection);
    const definition = config.test ?? {
      path: connection.baseUrl ?? "/",
      method: "GET" as const,
      bodyMode: "none" as const,
    };
    await this.execute(connection, config, definition, "connect");
  }

  public async listModels(connectionId: string): Promise<ModelDescriptor[]> {
    const connection = await this.connections.resolve(connectionId);
    const config = this.configFrom(connection);
    return (config.models ?? []).map((model) =>
      withCanonicalModelFields({ ...model }, connection.provider),
    );
  }

  public async validate(request: NormalizedRequest): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    if (request.prompt.trim().length === 0) {
      issues.push({
        path: "prompt",
        code: "required",
        message: "A prompt is required",
      });
    }
    try {
      const connection = await this.connections.resolve(request.connectionId);
      if (request.operation.startsWith("video.") && isJiasuApiUrl(connection.baseUrl) && jiasuVideoGroupMismatch(connection.settings))
        issues.push({ path: "model", code: "model_group_mismatch", message: "当前佳速 Key 绑定的分组与型号分组不一致，请同步正确分组后再生成。" });
      if (request.operation.startsWith("video.") && isJijiuApiUrl(connection.baseUrl) && jijiuVideoGroupMismatch(connection.settings))
        issues.push({ path: "model", code: "model_group_mismatch", message: "当前极九 Key 绑定的分组与型号分组不一致，请同步正确分组后再生成。" });
      issues.push(...imageEditingRequestIssues(imageEditingConnection(connection), request));
      const baseConfig = this.configFrom(connection);
      const catalog = connection.settings?.modelCatalogModels;
      const selectedModel = Array.isArray(catalog) ? (catalog as ModelDescriptor[]).find(model => model?.id === request.model) : undefined;
      const miaowuModel = selectedModel ?? baseConfig.models?.find(model => model.id === request.model);
      const cangyuanVideo = !this.fixedConfig && isCangyuanVideoRequest(request.model, connection.baseUrl);
      const remainingSupplier = !this.fixedConfig && !preservesMiaowuExplicitVideoContract(imageEditingConnection(connection).config, miaowuModel, request.operation) ? remainingVideoSupplier(connection.baseUrl) : undefined;
      const videoContext = remainingVideoContext(connection.settings, baseConfig.models?.find(m => m.id === request.model), request.assets);
      const remainingVideo = remainingSupplier && isRemainingVideoModel(remainingSupplier, request.model, videoContext);
      if (request.operation.startsWith("video.") && !remainingVideo && isMiaowuUnverifiedAutoVideoContract(imageEditingConnection(connection).config, miaowuModel, baseConfig, request.operation))
        issues.push({ path: "model", code: "interface_unavailable", message: `${MIAOWU_VIDEO_CONTRACT_PENDING_REASON}，当前生成尚未提交` });
      if (remainingVideo && request.operation.startsWith("video.")) {
        const ids = connection.settings?.scannedModelIds;
        const reason = String(selectedModel?.metadata?.canvasUnavailableReason ?? "");
        if (["empty", "unauthorized"].includes(String(connection.settings?.modelScanStatus)) ||
            connection.settings?.supplierArchived === true || ["disabled", "agent"].includes(String(connection.settings?.usage)) ||
            Array.isArray(ids) && !ids.includes(request.model) || /401|403|权限|未开通|拒绝|下架|停用|未返回|unauthorized|forbidden|not.?returned|unavailable|disabled/iu.test(reason))
          issues.push({ path: "model", code: "unavailable_inventory", message: "当前 Key 或分组没有此视频型号的可用权限。" });
        if (selectedModel && selectedModel.outputKinds?.length && selectedModel.metadata?.outputKindsSource !== "inferred" && !modelSupportsGenerationMedia(selectedModel, "video"))
          issues.push({ path: "model", code: "wrong_media_type", message: "当前型号未声明视频输出，不能用于视频节点。" });
      }
      const musicRequest = !this.fixedConfig && isCangyuanMusicRequest(request.model, connection.baseUrl);
      if (musicRequest) issues.push(...cangyuanMusicRequestIssues(request));
      if (cangyuanVideo || remainingVideo) {
        const hosting = referenceImageHostingEnabled(connection.settings);
        const jiasuUpload = remainingSupplier === "jiasu";
        const assets = request.assets?.map(asset => jiasuUpload && (asset.data || asset.url?.startsWith("data:"))
          ? { ...asset, url: `https://pending-jiasu-media.super-canvas.invalid/${encodeURIComponent(asset.id)}` }
          : hosting && asset.kind === "image" && asset.data && !asset.url
            ? { ...asset, url: `https://pending-reference.super-canvas.invalid/${encodeURIComponent(asset.id)}` } : asset);
        const prepared = { ...request, ...(assets ? { assets } : {}) };
        if (cangyuanVideo) issues.push(...validateCangyuanVideoRequest(prepared));
        if (remainingVideo) issues.push(...remainingVideoRequestIssues(remainingSupplier!, prepared, videoContext));
      }
      const videoRequest = ["rest", "openai"].includes(connection.provider) && isChuangxiangVideoConnection(imageEditingConnection(connection).config, request.model);
      if (videoRequest) {
        // Temporary hosting is authorized by this saved connection. Only image
        // bytes use that channel; video/audio still require existing public URLs.
        const hosting = referenceImageHostingEnabled(connection.settings);
        const assets = request.assets?.map(asset => hosting && asset.kind === "image" && asset.data && !asset.url
          ? { ...asset, url: `https://pending-reference.super-canvas.invalid/${encodeURIComponent(asset.id)}` } : asset);
        issues.push(...validateChuangxiangVideoRequest({ ...request, ...(assets ? { assets } : {}) }));
      }
      if (!this.fixedConfig && managesCangyuanCurrentTransport(connection.settings ?? {}, connection.baseUrl, baseConfig, request.model)) issues.push(...cangyuanCurrentRequestIssues(request, connection.baseUrl));
      const config = this.configFrom(
        connection,
        request.model,
        request.operation,
        request.assets,
      );
      if (request.assets?.some(asset => asset.role === "mask") || request.parameters?.mask) {
        const capabilities = getImageEditingCapabilities(imageEditingConnection(connection), request.model ?? "", request.parameters);
        if (capabilities.mask && (capabilities.mask !== "url" || config.submit.bodyMode !== "json"))
          issues.push({ path: "assets", code: "unsupported_mask_transport", message: "当前已配置的接口传输方式不支持此蒙版；请使用供应商的图片编辑接口。" });
      }
      const connectorModel = baseConfig.models?.find(
        (model) => model.id === request.model,
      );
      // A fresh exact Suno inventory can precede persistence of the connector's
      // model array. It only repairs this native contract for the same visible Key.
      const freshSuno = musicRequest && request.model === "suno" && selectedModel?.metadata?.canvasRunnable === true &&
        Array.isArray(connection.settings?.scannedModelIds) && connection.settings.scannedModelIds.includes("suno") &&
        !["empty", "unauthorized"].includes(String(connection.settings?.modelScanStatus)) &&
        connection.settings?.usage !== "disabled" && connection.settings?.supplierArchived !== true;
      const restoredVideo = remainingVideo && request.model ? restoreRemainingVideoModel(remainingSupplier, request.model, connectorModel ?? selectedModel, connection.settings, videoContext) : undefined;
      const savedModel = restoredVideo ?? connectorModel ?? (freshSuno ? selectedModel : undefined);
      const configuredModel = musicRequest && savedModel ? cangyuanMusicModel(savedModel)
        : videoRequest && savedModel ? chuangxiangVideoModel(savedModel.id, savedModel)
        : cangyuanVideo && savedModel ? cangyuanVideoModel(savedModel)
        : remainingVideo && savedModel ? remainingVideoModel(remainingSupplier!, savedModel.id, savedModel, videoContext) : savedModel;
      if (baseConfig.restrictModels && request.model && !configuredModel) {
        issues.push({
          path: "model",
          code: "unsupported_model",
          message: `${request.model} is not available in this connector's current model group`,
        });
      }
      if (
        configuredModel &&
        !configuredModel.operations.includes(request.operation)
      ) {
        issues.push({
          path: "operation",
          code: "unsupported_operation",
          message: `${configuredModel.name} does not support ${request.operation}`,
        });
      }
      if (configuredModel) {
        const media = request.operation.startsWith("image.") ? "image" : request.operation.startsWith("video.") ? "video" : "music";
        if (!modelSupportsGenerationMedia(configuredModel, media))
          issues.push({ path: "model", code: "wrong_media_type", message: "当前型号不支持此节点的生成类型，请重新选择型号。" });
        if (configuredModel.metadata?.canvasRunnable === false)
          issues.push({ path: "model", code: "unavailable_contract", message: "该型号接口合同尚未确认，请刷新模型或选择已支持的型号。" });
        if ((media === "video" && configuredModel.metadata?.parameterSource === "dream.video_schema" ||
            media === "image" && configuredModel.metadata?.parameterSource === "dream.image_schema") &&
            remainingVideoSupplier(connection.baseUrl) === "miaowu" &&
            configuredModel.metadata.source !== "manual" && configuredModel.metadata.protocolEvidence !== "paid-test") {
          const defaults = Object.fromEntries((configuredModel.parameters ?? []).filter(parameter => parameter.default !== undefined).map(parameter => [parameter.key, parameter.default]));
          const values = request.parameters ?? {};
          // Canvas image requests may carry the internal one-image count. The
          // documented Miaowu mapping omits n; larger counts are unsupported.
          const declared = media === "image" && values.n === 1 ? Object.fromEntries(Object.entries(values).filter(([key]) => key !== "n")) : values;
          issues.push(...validateModelParameters(configuredModel, { ...defaults, ...declared }, request.operation).issues);
          for (const key of Object.keys(declared)) if (!configuredModel.parameters?.some(parameter => parameter.key === key))
            issues.push({ path: `parameters.${key}`, code: "unsupported_parameter", message: `当前型号认证 schema 未声明参数 ${key}，本次生成尚未提交。` });
          const maximum = configuredModel.limits?.maxPromptCharacters;
          if (maximum !== undefined && [...request.prompt].length > maximum)
            issues.push({ path: "prompt", code: "prompt_too_long", message: `当前型号提示词最多 ${maximum} 个字符，本次生成尚未提交。` });
        }
        // Saved/manual video transports retain their own declared constraints,
        // even when a fixed connector deliberately bypasses native contracts.
        if (configuredModel.parameters?.length && (media === "video" || musicRequest)) {
          const values = musicRequest ? withCangyuanMusicRequestParameters(request).parameters ?? {} : request.parameters ?? {};
          const declared = Object.fromEntries(Object.entries(values).filter(([key]) => configuredModel.parameters?.some(p => p.key === key)));
          const defaults = Object.fromEntries(configuredModel.parameters.filter(p => p.default !== undefined && getModelParameterDescriptor(configuredModel, p.key, values, request.operation)).map(p => [p.key, p.default]));
          issues.push(...validateModelParameters(configuredModel, { ...defaults, ...declared }, request.operation).issues);
        }
        const imageCount =
          imageReferenceAssets(request.assets).filter((asset) => asset.kind === "image").length;
        const videoCount =
          request.assets?.filter((asset) => asset.kind === "video").length ?? 0;
        const audioCount =
          request.assets?.filter((asset) => asset.kind === "audio").length ?? 0;
        const limits = configuredModel.limits;
        for (const [kind, perItem, total] of [
          ["video", limits?.maxInputVideoDurationSeconds, limits?.maxTotalInputVideoDurationSeconds],
          ["audio", limits?.maxInputAudioDurationSeconds, configuredModel.metadata?.maxTotalInputAudioDurationSeconds],
        ] as const) {
          const assets = request.assets?.filter(asset => asset.kind === kind) ?? [];
          if (!assets.length || perItem === undefined && typeof total !== "number") continue;
          if (assets.some(asset => !Number.isFinite(asset.durationSeconds) || asset.durationSeconds! <= 0))
            issues.push({ path: "assets", code: "unknown_media_duration", message: `无法读取参考${kind === "video" ? "视频" : "音频"}的实际时长，请使用可读取时长的素材后重试。` });
          else if ((perItem !== undefined && assets.some(asset => asset.durationSeconds! > perItem)) ||
            (typeof total === "number" && assets.reduce((sum, asset) => sum + asset.durationSeconds!, 0) > total))
            issues.push({ path: "assets", code: "media_duration_exceeded", message: `参考${kind === "video" ? "视频" : "音频"}时长超过该型号限制。` });
        }
        if (
          request.operation === "image.edit" &&
          configuredModel.operations.includes(request.operation) &&
          imageCount === 0
        ) {
          issues.push({
            path: "assets",
            code: "missing_image",
            message: `${configuredModel.name} requires an input image for image editing`,
          });
        }
        if (
          limits?.maxInputImages !== undefined &&
          imageCount > limits.maxInputImages
        )
          issues.push({
            path: "assets",
            code: "too_many_images",
            message: `${configuredModel.name} supports at most ${limits.maxInputImages} input image(s)`,
          });
        if (
          limits?.maxInputVideos !== undefined &&
          videoCount > limits.maxInputVideos
        )
          issues.push({
            path: "assets",
            code: "too_many_videos",
            message: `${configuredModel.name} supports at most ${limits.maxInputVideos} input video(s)`,
          });
        if (
          limits?.maxInputAssets !== undefined &&
          imageCount + videoCount + audioCount > limits.maxInputAssets
        )
          issues.push({
            path: "assets",
            code: "too_many_assets",
            message: `${configuredModel.name} supports at most ${limits.maxInputAssets} reference asset(s)`,
          });
        if (
          limits?.maxInputAudios !== undefined &&
          audioCount > limits.maxInputAudios
        ) {
          issues.push({
            path: "assets",
            code: "too_many_audios",
            message: `${configuredModel.name} supports at most ${limits.maxInputAudios} input audio(s)`,
          });
        }
        if (
          configuredModel.metadata?.requiresImageWithAudio === true &&
          audioCount > 0 &&
          imageCount === 0
        ) {
          issues.push({
            path: "assets",
            code: "audio_requires_image",
            message: `${configuredModel.name} requires an input image when reference audio is used`,
          });
        }
        if (limits?.requiresInputImage && imageCount === 0)
          issues.push({
            path: "assets",
            code: "missing_image",
            message: `${configuredModel.name} requires an input image`,
          });
        if (limits?.requiresInputVideo && videoCount === 0)
          issues.push({
            path: "assets",
            code: "missing_video",
            message: `${configuredModel.name} requires an input video`,
          });
        if (request.operation.startsWith("video.") &&
          configuredModel.metadata?.parameterSource === "dream.video_schema" &&
          configuredModel.metadata.supportsFirstLastFrames === false &&
          request.assets?.some(asset => asset.role === "firstFrame" || asset.role === "lastFrame")) {
          issues.push({
            path: "assets",
            code: "unsupported_frame_role",
            message: `${configuredModel.name} 当前原生 schema 只支持普通参考素材，不支持首尾帧角色；请明确选择参考图后再提交。`,
          });
        }
        if (configuredModel.metadata?.supportsFirstLastFrames === true) {
          const firstFrames =
            request.assets?.filter((asset) => asset.role === "firstFrame") ??
            [];
          const lastFrames =
            request.assets?.filter((asset) => asset.role === "lastFrame") ?? [];
          const references =
            request.assets?.filter(
              (asset) =>
                asset.role !== "firstFrame" && asset.role !== "lastFrame",
            ) ?? [];
          if (lastFrames.length > 0 && firstFrames.length === 0) {
            issues.push({
              path: "assets",
              code: "incomplete_frame_pair",
              message: `${configuredModel.name} requires first and last frames together`,
            });
          }
          if (
            (firstFrames.length > 0 || lastFrames.length > 0) &&
            references.length > 0 &&
            configuredModel.metadata?.allowFrameMediaMix !== true
          ) {
            issues.push({
              path: "assets",
              code: "mixed_reference_modes",
              message: `${configuredModel.name} cannot mix first/last frames with other references`,
            });
          }
        }
      }
      const authType = config.auth?.type ?? "bearer";
      if (
        (authType === "bearer" || authType === "header") &&
        !connection.apiKey
      ) {
        issues.push({
          path: "connection.apiKey",
          code: "missing_credential",
          message: "A REST connector API key is required for this auth mode",
        });
      }
      for (const [label, definition] of [
        ["submit", config.submit],
        ["poll", config.poll],
        ["cancel", config.cancel],
        ["test", config.test],
      ] as const) {
        if (!definition) continue;
        try {
          this.resolveUrl(
            connection.baseUrl,
            definition.path,
            config,
            "validation-task-id",
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Invalid REST connector URL";
          throw new Error(`${label} endpoint is invalid: ${message}`);
        }
      }
      if (
        (config.submit.response?.taskIdPath ||
          config.submit.response?.taskIdFallbackPaths?.length) &&
        !config.poll
      ) {
        throw new Error(
          "REST connector maps an asynchronous task id but does not define a poll endpoint",
        );
      }
      validatePath(config.output.path);
      for (const path of config.output.fallbackPaths ?? []) validatePath(path);
      validatePath(config.output.urlPath, true);
      for (const path of config.output.urlFallbackPaths ?? [])
        validatePath(path, true);
      validatePath(config.output.base64Path, true);
      for (const path of config.output.base64FallbackPaths ?? [])
        validatePath(path, true);
      validatePath(config.output.mimeTypePath, true);
      validatePath(config.output.filenamePath, true);
      for (const definition of [
        config.submit,
        config.poll,
        config.cancel,
        config.test,
      ]) {
        if (!definition?.response) continue;
        validatePath(definition.response.taskIdPath);
        for (const path of definition.response.taskIdFallbackPaths ?? [])
          validatePath(path);
        validatePath(definition.response.statusPath);
        for (const path of definition.response.statusFallbackPaths ?? [])
          validatePath(path);
        validatePath(definition.response.errorPath);
        for (const path of definition.response.errorFallbackPaths ?? [])
          validatePath(path);
        validatePath(definition.response.progressPath);
      }
      // Build the request during preflight so unsafe paths and missing mappings
      // fail before a paid endpoint is called.
      const preflightRequest = musicRequest ? withCangyuanMusicRequestParameters(request)
        : videoRequest ? { ...request, parameters: normalizeChuangxiangVideoParameters(request) }
        : cangyuanVideo ? { ...request, parameters: normalizeCangyuanVideoParameters(request) }
        : remainingVideo ? { ...request, parameters: normalizeRemainingVideoParameters(remainingSupplier!, request, videoContext) } : request;
      const body = await this.buildBody(config.submit, preflightRequest, undefined);
      const method = config.submit.method ?? (body === undefined ? "GET" : "POST");
      const bodyMode = config.submit.bodyMode ?? (method === "GET" || method === "DELETE" ? "none" : "json");
      this.transparentSubmitBody(connection, request, this.resolveUrl(connection.baseUrl, config.submit.path, config), method, bodyMode, body);
    } catch (error) {
      issues.push({
        path: "connection",
        code: "invalid_connector",
        message:
          error instanceof Error
            ? error.message
            : "Invalid REST connector configuration",
      });
    }
    return { valid: issues.length === 0, issues };
  }

  public async submit(request: NormalizedRequest): Promise<ProviderTask> {
    assertValidResult(await this.validate(request));
    const connection = await this.connections.resolve(request.connectionId);
    let config = this.configFrom(
      connection,
      request.model,
      request.operation,
      request.assets,
    );
    if (!this.fixedConfig && /^midjourney-[12]k$/u.test(request.model ?? "") &&
        managesCangyuanCurrentTransport(connection.settings ?? {}, connection.baseUrl, this.configFrom(connection), request.model)) {
      const current = cangyuanCurrentTransport(request.model!, request.parameters)!;
      config = { ...config, ...current, ...current.operationOverrides?.[request.operation] };
    }
    const editingConnection = imageEditingConnection(connection);
    const capabilities = getImageEditingCapabilities(editingConnection, request.model ?? "", request.parameters);
    const hasMask = request.assets?.some(asset => asset.role === "mask") || Boolean(request.parameters?.mask);
    if (hasMask && capabilities.mask === "url") {
      const cangyuan = connection.provider === "rest" && /(^|\.)cangyuansuanli\.cn$/u.test(new URL(connection.baseUrl!).hostname);
      config = { ...config, assetsRequirePublicUrls: true,
        submit: { ...config.submit,
          ...(cangyuan ? { path: "/v1/images/edits" } : {}),
          mappings: [...(config.submit.mappings ?? []).filter(mapping => mapping.target !== "/mask" && mapping.target !== "/images"),
            { target: "/images", source: { kind: "assets", assetKind: "image", select: "all" } },
            { target: "/mask", source: { kind: "request", path: "$.parameters.mask" }, omitIfUndefined: true, omitIfEmpty: true },
            { target: "/mask", source: { kind: "assets", assetKind: "image", role: "mask", select: "first" }, omitIfUndefined: true }],
        },
        ...(cangyuan && config.poll ? { poll: { ...config.poll, path: "/v1/images/edits/{taskId}" } } : {}),
      };
    }
    let outboundRequest = withNearestSupportedAspectRatio({ ...request,
      parameters: normalizeImageEditingParameters(editingConnection, request.model ?? "", request.parameters) }, config);
    if (!this.fixedConfig && isCangyuanMusicRequest(request.model, connection.baseUrl)) {
      outboundRequest = withCangyuanMusicRequestParameters(request);
      config = { ...config, ...cangyuanMusicTransport(outboundRequest.parameters?.audio_format, request.model) };
    }
    if (!this.fixedConfig && managesCangyuanCurrentTransport(connection.settings ?? {}, connection.baseUrl, this.configFrom(connection), request.model))
      outboundRequest = withCangyuanCurrentRequestParameters(outboundRequest, connection.baseUrl);
    if (request.operation.startsWith("video.") && isJiasuApiUrl(connection.baseUrl) && request.assets?.length)
      outboundRequest = { ...outboundRequest, assets: await uploadJiasuMedia(connection, request.assets, {
        fetch: this.fetchImpl, requestTimeoutMs: this.requestTimeoutMs,
      }) };
    if (outboundRequest.assets?.length && restRequestRequiresPublicAssets(config)) {
      const needsHosting = outboundRequest.assets.some(asset => !asset.url?.startsWith("https://"));
      if (needsHosting && !referenceImageHostingEnabled(connection.settings))
        throw new Error("该模型需要参考图 HTTPS 链接。请在供应商分组中启用参考图临时链接，再重新运行；当前生成尚未提交。");
      if (needsHosting) outboundRequest = { ...outboundRequest, assets: await uploadTemporaryReferenceImages(outboundRequest.assets, this.fetchImpl) };
    }
    const videoRequest = ["rest", "openai"].includes(connection.provider) && isChuangxiangVideoConnection(imageEditingConnection(connection).config, request.model);
    if (videoRequest) outboundRequest = { ...outboundRequest, parameters: normalizeChuangxiangVideoParameters(outboundRequest) };
    if (!this.fixedConfig && isCangyuanVideoRequest(request.model, connection.baseUrl)) outboundRequest = { ...outboundRequest, parameters: normalizeCangyuanVideoParameters(outboundRequest) };
    const remainingSupplier = !this.fixedConfig && !preservesMiaowuExplicitVideoContract(imageEditingConnection(connection).config, config.models?.find(model => model.id === request.model), request.operation) ? remainingVideoSupplier(connection.baseUrl) : undefined;
    const videoContext = remainingVideoContext(connection.settings, config.models?.find(m => m.id === request.model), outboundRequest.assets);
    if (remainingSupplier && isRemainingVideoModel(remainingSupplier, request.model, videoContext)) outboundRequest = { ...outboundRequest, parameters: normalizeRemainingVideoParameters(remainingSupplier, outboundRequest, videoContext) };
    let videoOutputParameters: Record<string, unknown> | undefined;
    const received = await this.execute(
      connection,
      config,
      config.submit,
      "submit",
      outboundRequest,
      undefined,
      config.output.kind === "video" ? body => { videoOutputParameters = videoOutputParametersFromBody(body); } : undefined,
    );
    const cloudTask = isRecord(received) && typeof received.__superCanvasCloudPoll === "string" ? received.__superCanvasCloudPoll : undefined;
    const remote = cloudTask ? (received as Record<string, unknown>).remote : received;
    const mapping = cloudTask ? config.poll?.response : config.submit.response;
    const rawTaskId = mapping
      ? responseValue(remote, mapping.taskIdPath, mapping.taskIdFallbackPaths)
      : undefined;
    if (!this.fixedConfig && isCangyuanMusicRequest(request.model, connection.baseUrl) && !cloudTask &&
        !(typeof rawTaskId === "string" && rawTaskId.trim() || typeof rawTaskId === "number" && Number.isFinite(rawTaskId))) {
      throw Object.assign(new ProviderHttpError("沧元已响应音乐提交但没有返回任务 ID；任务可能已受理，请核对供应商记录，禁止自动重复提交。", {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true, responseBody: remote,
      }), { code: "music_submit_missing_id" });
    }
    if (config.output.format !== "openai-chat-videos" && (videoRequest || !this.fixedConfig && (isCangyuanVideoRequest(request.model, connection.baseUrl) || remainingSupplier && isRemainingVideoModel(remainingSupplier, request.model, videoContext))) && !cloudTask &&
        !(typeof rawTaskId === "string" && rawTaskId.trim() || typeof rawTaskId === "number" && Number.isFinite(rawTaskId)))
      throw new ProviderHttpError("供应商已响应但未返回视频任务 ID；请核对供应商记录，避免重复提交。", {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true, responseBody: remote,
      });
    const providerTaskId =
      cloudTask ?? (typeof rawTaskId === "string" || typeof rawTaskId === "number"
        ? String(rawTaskId)
        : `rest:sync:${request.idempotencyKey}`);
    const rawStatus = mapping
      ? responseValue(remote, mapping.statusPath, mapping.statusFallbackPaths)
      : undefined;
    const fallback: ProviderTaskStatus =
      rawTaskId === undefined ? "succeeded" : "running";
    const status = normalizeStatus(rawStatus, config, fallback);
    const envelope: RestTaskEnvelope = {
      connectionId: request.connectionId,
      config,
      remote,
      ...(cloudTask ? { taskId: cloudTask } : typeof rawTaskId === "string" || typeof rawTaskId === "number" ? { taskId: String(rawTaskId) } : {}),
      status,
      ...(request.model ? { model: request.model } : {}),
      ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
      ...(videoOutputParameters === undefined ? {} : { videoOutputParameters }),
    };
    const result: ProviderTask = {
      providerTaskId,
      id: providerTaskId,
      status,
      ...(config.pollIntervalMs === undefined
        ? {}
        : { pollAfterMs: config.pollIntervalMs }),
      result: envelope,
    };
    if (status === "failed" && mapping) {
      const error = responseValue(
        remote,
        mapping.errorPath,
        mapping.errorFallbackPaths,
      );
      if (error !== undefined) result.error = String(error);
    }
    if (status === "succeeded" && (config.output.format || config.output.requireOutput) && !(await this.extractOutputs(envelope)).length)
      throw new ProviderHttpError(`供应商已返回响应但没有${config.output.kind === "video" ? "视频" : "图片"}；请核对供应商记录和响应，避免重复提交。`, {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true, responseBody: remote,
      });
    return result;
  }

  public async poll(task: ProviderTask): Promise<NormalizedTaskState> {
    const taskId = getProviderTaskId(task);
    const envelope = envelopeFrom(task);
    if (!envelope.config.poll)
      throw new Error("REST connector does not define polling");
    const connection = await this.connections.resolve(envelope.connectionId);
    // Resuming an old task repairs only its GET route and continues the same ID.
    if (["rest", "openai"].includes(connection.provider) && envelope.config.output.kind === "video" &&
        isChuangxiangVideoConnection(imageEditingConnection(connection).config, envelope.model)) {
      const current = chuangxiangVideoTransport();
      envelope.config = { ...envelope.config, poll: current.poll!, output: current.output!, statusMap: current.statusMap!,
        pollIntervalMs: CHUANGXIANG_VIDEO_POLL_INTERVAL_MS };
    }
    if (!envelope.config.poll) throw new Error("REST connector does not define polling");
    const remote = await this.execute(
      connection,
      envelope.config,
      envelope.config.poll,
      "poll",
      undefined,
      task,
    );
    const mapping = envelope.config.poll.response;
    const rawStatus = mapping
      ? responseValue(remote, mapping.statusPath, mapping.statusFallbackPaths)
      : undefined;
    const status = normalizeStatus(rawStatus, envelope.config, "running");
    const state: NormalizedTaskState = {
      providerTaskId: taskId,
      id: task.id ?? taskId,
      status,
      ...(envelope.config.pollIntervalMs === undefined
        ? {}
        : { pollAfterMs: envelope.config.pollIntervalMs }),
      result: { ...envelope, remote, status },
    };
    if (mapping?.progressPath) {
      const progress = normalizeProgress(
        readJsonPath(remote, mapping.progressPath),
      );
      if (progress !== undefined) state.progress = progress;
    }
    if (status === "failed" && mapping) {
      const error = responseValue(
        remote,
        mapping.errorPath,
        mapping.errorFallbackPaths,
      );
      if (error !== undefined) state.error = String(error);
    }
    return state;
  }

  public async cancel(task: ProviderTask): Promise<void> {
    const envelope = envelopeFrom(task);
    if (!envelope.config.cancel) return;
    const connection = await this.connections.resolve(envelope.connectionId);
    await this.execute(
      connection,
      envelope.config,
      envelope.config.cancel,
      "cancel",
      undefined,
      task,
    );
  }

  public async verifyWebhook(
    request: Request,
    connectionId?: string,
  ): Promise<NormalizedTaskState> {
    if (!connectionId)
      throw new Error("REST webhook verification requires a connection id");
    const connection = await this.connections.resolve(connectionId);
    const config = this.configFrom(connection);
    const webhook = config.webhook;
    if (!webhook) throw new Error("REST connector webhook is not configured");
    const secret = requireApiKey(connection);
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > 2 * 1024 * 1024)
      throw new Error("REST webhook body is too large");
    const headerName = webhook.signatureHeader ?? "x-signature";
    const supplied = request.headers.get(headerName);
    if (!supplied) throw new Error("REST webhook signature is missing");
    const prefix = webhook.signaturePrefix ?? "";
    const signature = supplied.startsWith(prefix)
      ? supplied.slice(prefix.length)
      : supplied;
    const digest = createHmac("sha256", secret).update(raw).digest();
    const candidates = [digest.toString("hex"), digest.toString("base64")];
    if (
      !candidates.some((candidate) => {
        const left = Buffer.from(signature);
        const right = Buffer.from(candidate);
        return left.length === right.length && timingSafeEqual(left, right);
      })
    )
      throw new Error("REST webhook signature is invalid");
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      throw new Error("REST webhook payload must be valid JSON");
    }
    const rawTaskId = readJsonPath(payload, webhook.taskIdPath);
    if (typeof rawTaskId !== "string" && typeof rawTaskId !== "number")
      throw new Error("REST webhook task id is missing");
    const rawStatus = webhook.statusPath
      ? readJsonPath(payload, webhook.statusPath)
      : undefined;
    const status = normalizeStatus(rawStatus, config, "succeeded");
    const state: NormalizedTaskState = {
      providerTaskId: String(rawTaskId),
      id: String(rawTaskId),
      status,
      result: { connectionId, config, remote: payload, taskId: String(rawTaskId), status },
    };
    if (webhook.errorPath) {
      const error = readJsonPath(payload, webhook.errorPath);
      if (error !== undefined) state.error = String(error);
    }
    if (webhook.progressPath) {
      const progress = normalizeProgress(
        readJsonPath(payload, webhook.progressPath),
      );
      if (progress !== undefined) state.progress = progress;
    }
    return state;
  }

  public async extractOutputs(result: unknown): Promise<RemoteArtifact[]> {
    if (!isRecord(result) || !isRecord(result.config)) return [];
    assertConfig(result.config);
    const config = result.config;
    const remote = result.remote;
    let baseUrl =
      typeof result.baseUrl === "string" ? result.baseUrl : undefined;
    if (!baseUrl && typeof result.connectionId === "string") {
      try {
        baseUrl = (await this.connections.resolve(result.connectionId)).baseUrl;
      } catch {
        // Output extraction still supports absolute URLs if a deleted
        // connection can no longer be resolved.
      }
    }
    const outputUrl = (value: string): string => {
      if (!baseUrl) return value;
      try {
        return new URL(value, `${baseUrl.replace(/\/+$/u, "")}/`).toString();
      } catch {
        return value;
      }
    };
    const compatibilityFallbackPaths =
      config.output.kind === "video"
        ? ["$.video_url", "$.metadata.video_url", "$.metadata.url"]
        : [];
    const candidates = [
      config.output.path,
      ...(config.output.fallbackPaths ?? []),
      ...compatibilityFallbackPaths,
    ]
      .map((path) => readJsonPath(remote, path));
    if (config.output.format) {
      // An empty choices array or ordinary chat text must not hide a valid
      // media field supplied by the same synchronous response.
      for (const candidate of candidates) {
        const outputs = chatMediaOutputs(candidate, config.output.kind === "video" ? "video" : "image", config.output.defaultMimeType);
        if (outputs.length) return outputs;
      }
      return [];
    }
    const selected = candidates.find((value) => value !== undefined && value !== null && value !== "");
    const values = Array.isArray(selected)
      ? selected
      : selected === undefined
        ? []
        : [selected];
    const outputs = values.flatMap((value): RemoteArtifact[] => {
      if (typeof value === "string") {
        return [
          {
            kind: config.output.kind,
            url: outputUrl(value),
            ...(config.output.defaultMimeType
              ? { mimeType: config.output.defaultMimeType }
              : {}),
          },
        ];
      }
      if (!isRecord(value)) return [];
      const url = [
        config.output.urlPath ?? "url",
        ...(config.output.urlFallbackPaths ?? []),
      ]
        .map((path) => relativePath(value, path))
        .find((item) => item !== undefined && item !== null && item !== "");
      const base64 = [
        ...(config.output.base64Path ? [config.output.base64Path] : []),
        ...(config.output.base64FallbackPaths ?? []),
      ]
        .map((path) => relativePath(value, path))
        .find((item) => item !== undefined && item !== null && item !== "");
      const mimeType = relativePath(value, config.output.mimeTypePath);
      const filename = relativePath(value, config.output.filenamePath);
      if (typeof url === "string") {
        return [
          {
            kind: config.output.kind,
            url: outputUrl(url),
            ...(typeof mimeType === "string"
              ? { mimeType }
              : config.output.defaultMimeType
                ? { mimeType: config.output.defaultMimeType }
                : {}),
            ...(typeof filename === "string" ? { filename } : {}),
          },
        ];
      }
      if (typeof base64 === "string") {
        const dataUri = /data:([^;,\s]+);base64,([A-Za-z0-9+/=\r\n]+)/u.exec(
          base64,
        );
        const compact = base64.replace(/\s+/gu, "");
        const rawBase64 = /^[A-Za-z0-9+/]+={0,2}$/u.test(compact)
          ? compact
          : /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{10000,}={0,2})(?:$|[^A-Za-z0-9+/=])/u.exec(
              base64,
            )?.[1];
        const encoded = dataUri?.[2] ?? rawBase64;
        if (!encoded) return [];
        return [
          {
            kind: config.output.kind,
            data: new Uint8Array(Buffer.from(encoded, "base64")),
            ...(typeof mimeType === "string"
              ? { mimeType }
              : dataUri?.[1]
                ? { mimeType: dataUri[1] }
                : config.output.defaultMimeType
                  ? { mimeType: config.output.defaultMimeType }
                  : {}),
            ...(typeof filename === "string" ? { filename } : {}),
          },
        ];
      }
      return [];
    });
    const content = config.output.contentFallback;
    if (!content || typeof result.connectionId !== "string" || !baseUrl) return outputs;
    const mapping = config.poll?.response ?? config.submit.response;
    const rawTaskId = typeof result.taskId === "string" ? result.taskId
      : mapping ? responseValue(remote, mapping.taskIdPath, mapping.taskIdFallbackPaths) : undefined;
    const rawStatus = mapping ? responseValue(remote, mapping.statusPath, mapping.statusFallbackPaths) : undefined;
    const status = result.status ?? normalizeStatus(rawStatus, config, "running");
    if (status !== "succeeded" || !["string", "number"].includes(typeof rawTaskId) || !String(rawTaskId).trim()) return outputs;
    const taskId = String(rawTaskId);
    // URL parsers normalize these segments even after encodeURIComponent.
    if (taskId === "." || taskId === "..") return outputs;
    const contentUrls = [content.path, ...(content.alternatePaths ?? [])]
      .map(path => this.resolveUrl(baseUrl, path, config, taskId));
    if (contentUrls.some(url => new URL(url).origin !== new URL(baseUrl).origin))
      throw new Error("REST task content must belong to the completed task origin");
    const matchesContent = (url: string) => contentUrls.some(candidate => {
      const expected = new URL(candidate), actual = new URL(url);
      return actual.origin === expected.origin && actual.pathname === expected.pathname;
    });
    if (outputs.length && !outputs.some(output => output.url && matchesContent(output.url))) return outputs;
    const connection = await this.connections.resolve(result.connectionId);
    if (!connection.baseUrl || new URL(connection.baseUrl).origin !== new URL(baseUrl).origin)
      throw new Error("REST task content no longer belongs to the current connection origin");
    const download = async (url: string): Promise<RemoteArtifact> => {
      if (!matchesContent(url)) throw new Error("REST task content URL does not match the completed task");
      const headers = this.headers(connection, config, { path: content.path, method: "GET", bodyMode: "none" });
      const downloaded = await fetchProviderBytes((input, init) => this.fetchImpl(input, { ...init, method: "GET", headers }), url,
        { phase: "archive", timeoutMs: this.requestTimeoutMs, maxResponseBytes: config.output.kind === "image" ? 64 * 1024 * 1024 : 200 * 1024 * 1024 });
      if (!downloaded.data.length) throw new Error("REST task content was empty");
      return { kind: config.output.kind, data: downloaded.data,
        ...((downloaded.mimeType ?? config.output.defaultMimeType) ? { mimeType: downloaded.mimeType ?? config.output.defaultMimeType } : {}) };
    };
    if (!outputs.length) return [await download(contentUrls[0]!)];
    return Promise.all(outputs.map(output => output.url && matchesContent(output.url) ? download(output.url) : output));
  }
}

/** Naming aliases used by connector configuration/UI code. */
export const GenericRestConnector = GenericRestAdapter;
export const RestConnector = GenericRestAdapter;
