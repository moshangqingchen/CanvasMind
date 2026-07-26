import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ArtifactKind,
  FetchImplementation,
  ModelDescriptor,
  NormalizedRequest,
  NormalizedTaskState,
  ProviderAdapter,
  ProviderAssetInput,
  ProviderConnectionResolver,
  ProviderTask,
  ProviderTaskStatus,
  RemoteArtifact,
  ValidationIssue,
  ValidationResult,
} from "./contracts.js";
import {
  assertValidResult,
  getProviderTaskId,
  withCanonicalModelFields,
} from "./contracts.js";
import {
  assetAsUrl,
  assetToBlob,
  fetchProviderJson,
  mergeHeaders,
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
      select?: "all" | "first";
    }
  | { kind: "assetMode"; frameValue: string; referenceValue: string }
  | { kind: "literal"; value: unknown };

export interface RestRequestMapping {
  /** RFC 6901 pointer within the outbound request body. */
  target: string;
  source: RestSource;
  omitIfUndefined?: boolean;
  omitIfEmpty?: boolean;
}

export interface RestResponseMapping {
  taskIdPath?: string;
  statusPath?: string;
  errorPath?: string;
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
  /** Relative JSONPaths used when selected outputs are objects. */
  urlPath?: string;
  base64Path?: string;
  mimeTypePath?: string;
  filenamePath?: string;
  defaultMimeType?: string;
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
  allowInsecureHttp?: boolean;
  webhook?: RestWebhookConfig;
  /** Transport differences for model families sharing one connection. */
  modelOverrides?: Readonly<Record<string, RestModelConnectorOverride>>;
}

export interface RestModelConnectorOverride {
  submit?: RestRequestDefinition;
  poll?: RestRequestDefinition;
  cancel?: RestRequestDefinition;
  output?: RestOutputMapping;
  statusMap?: Readonly<Record<string, ProviderTaskStatus>>;
  pollIntervalMs?: number;
}

interface RestTaskEnvelope {
  connectionId: string;
  config: RestConnectorConfig;
  remote: unknown;
  baseUrl?: string;
}

export interface GenericRestAdapterOptions {
  fetch?: FetchImplementation;
  requestTimeoutMs?: number;
  /** Optional fixed config; otherwise connection.settings.connector is used. */
  config?: RestConnectorConfig;
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
        mapping.source.select !== "first"
      ) {
        throw new Error(`${label}.mappings[${index}].source.select is invalid`);
      }
      if (
        mapping.source.excludeRoles !== undefined &&
        !Array.isArray(mapping.source.excludeRoles)
      ) {
        throw new Error(
          `${label}.mappings[${index}].source.excludeRoles must be an array`,
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
    } else if (mapping.source.kind === "literal") {
      if (!Object.hasOwn(mapping.source, "value")) {
        throw new Error(
          `${label}.mappings[${index}].literal source needs a value`,
        );
      }
    } else {
      throw new Error(`${label}.mappings[${index}].source.kind is invalid`);
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
  if (value.output.kind !== "image" && value.output.kind !== "video") {
    throw new Error("REST connector output.kind must be image or video");
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
            override.output.kind !== "video"))
      ) {
        throw new Error(
          `REST connector modelOverrides.${model}.output is invalid`,
        );
      }
    }
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
        (source.role === undefined || asset.role === source.role) &&
        !(source.excludeRoles ?? []).includes(asset.role ?? "reference"),
    );
    return source.select === "first" ? assets[0] : assets;
  }
  if (source.kind === "assetMode") {
    const hasFrame = (request?.assets ?? []).some(
      (asset) => asset.role === "firstFrame" || asset.role === "lastFrame",
    );
    return hasFrame ? source.frameValue : source.referenceValue;
  }
  if (source.kind === "request")
    return request ? readJsonPath(request, source.path) : undefined;
  return task ? readJsonPath(task, source.path) : undefined;
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
  private readonly fixedConfig: RestConnectorConfig | undefined;

  public constructor(
    private readonly connections: ProviderConnectionResolver,
    options: GenericRestAdapterOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.fixedConfig = options.config;
  }

  private configFrom(
    connection: Awaited<ReturnType<ProviderConnectionResolver["resolve"]>>,
    model?: string,
  ): RestConnectorConfig {
    const value = this.fixedConfig ?? connection.settings?.["connector"];
    assertConfig(value);
    const base = cloneJsonValue(value);
    const override = model ? base.modelOverrides?.[model] : undefined;
    if (!override) return base;
    return {
      ...base,
      ...(override.submit ? { submit: override.submit } : {}),
      ...(override.poll ? { poll: override.poll } : {}),
      ...(override.cancel ? { cancel: override.cancel } : {}),
      ...(override.output ? { output: override.output } : {}),
      ...(override.statusMap ? { statusMap: override.statusMap } : {}),
      ...(override.pollIntervalMs !== undefined
        ? { pollIntervalMs: override.pollIntervalMs }
        : {}),
    };
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
      const mapped = sourceValue(mapping.source, request, task);
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
  ): Promise<unknown> {
    const body = await this.buildBody(definition, request, task);
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
    if (bodyMode === "json" && body !== undefined) {
      headers.set("content-type", "application/json");
    } else if (bodyMode === "multipart") {
      // Let fetch append the boundary; a caller-supplied JSON content type
      // would make multipart uploads unreadable by most APIs.
      headers.delete("content-type");
    }
    return fetchProviderJson<unknown>(
      this.fetchImpl,
      this.resolveUrl(connection.baseUrl, definition.path, config, taskId),
      {
        method,
        headers,
        redirect: "error",
        ...(body === undefined ? {} : { body }),
      },
      {
        phase,
        timeoutMs: this.requestTimeoutMs,
        idempotent: definition.idempotent === true,
        allowEmpty: phase === "cancel",
      },
    );
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
      const baseConfig = this.configFrom(connection);
      const config = this.configFrom(connection, request.model);
      const configuredModel = baseConfig.models?.find(
        (model) => model.id === request.model,
      );
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
        const imageCount =
          request.assets?.filter((asset) => asset.kind === "image").length ?? 0;
        const videoCount =
          request.assets?.filter((asset) => asset.kind === "video").length ?? 0;
        const audioCount =
          request.assets?.filter((asset) => asset.kind === "audio").length ?? 0;
        const limits = configuredModel.limits;
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
          if (firstFrames.length > 0 !== lastFrames.length > 0) {
            issues.push({
              path: "assets",
              code: "incomplete_frame_pair",
              message: `${configuredModel.name} requires first and last frames together`,
            });
          }
          if (
            (firstFrames.length > 0 || lastFrames.length > 0) &&
            references.length > 0
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
      if (config.submit.response?.taskIdPath && !config.poll) {
        throw new Error(
          "REST connector maps an asynchronous task id but does not define a poll endpoint",
        );
      }
      validatePath(config.output.path);
      for (const path of config.output.fallbackPaths ?? []) validatePath(path);
      validatePath(config.output.urlPath, true);
      validatePath(config.output.base64Path, true);
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
        validatePath(definition.response.statusPath);
        validatePath(definition.response.errorPath);
        validatePath(definition.response.progressPath);
      }
      // Build the request during preflight so unsafe paths and missing mappings
      // fail before a paid endpoint is called.
      await this.buildBody(config.submit, request, undefined);
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
    const config = this.configFrom(connection, request.model);
    const remote = await this.execute(
      connection,
      config,
      config.submit,
      "submit",
      request,
    );
    const mapping = config.submit.response;
    const rawTaskId = mapping?.taskIdPath
      ? readJsonPath(remote, mapping.taskIdPath)
      : undefined;
    const providerTaskId =
      typeof rawTaskId === "string" || typeof rawTaskId === "number"
        ? String(rawTaskId)
        : `rest:sync:${request.idempotencyKey}`;
    const rawStatus = mapping?.statusPath
      ? readJsonPath(remote, mapping.statusPath)
      : undefined;
    const fallback: ProviderTaskStatus =
      rawTaskId === undefined ? "succeeded" : "running";
    const status = normalizeStatus(rawStatus, config, fallback);
    const envelope: RestTaskEnvelope = {
      connectionId: request.connectionId,
      config,
      remote,
      ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
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
    if (status === "failed" && mapping?.errorPath) {
      const error = readJsonPath(remote, mapping.errorPath);
      if (error !== undefined) result.error = String(error);
    }
    return result;
  }

  public async poll(task: ProviderTask): Promise<NormalizedTaskState> {
    const taskId = getProviderTaskId(task);
    const envelope = envelopeFrom(task);
    if (!envelope.config.poll)
      throw new Error("REST connector does not define polling");
    const connection = await this.connections.resolve(envelope.connectionId);
    const remote = await this.execute(
      connection,
      envelope.config,
      envelope.config.poll,
      "poll",
      undefined,
      task,
    );
    const mapping = envelope.config.poll.response;
    const rawStatus = mapping?.statusPath
      ? readJsonPath(remote, mapping.statusPath)
      : undefined;
    const status = normalizeStatus(rawStatus, envelope.config, "running");
    const state: NormalizedTaskState = {
      providerTaskId: taskId,
      id: task.id ?? taskId,
      status,
      ...(envelope.config.pollIntervalMs === undefined
        ? {}
        : { pollAfterMs: envelope.config.pollIntervalMs }),
      result: { ...envelope, remote },
    };
    if (mapping?.progressPath) {
      const progress = normalizeProgress(
        readJsonPath(remote, mapping.progressPath),
      );
      if (progress !== undefined) state.progress = progress;
    }
    if (status === "failed" && mapping?.errorPath) {
      const error = readJsonPath(remote, mapping.errorPath);
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
      result: { connectionId, config, remote: payload },
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
    const selected = [
      config.output.path,
      ...(config.output.fallbackPaths ?? []),
      ...compatibilityFallbackPaths,
    ]
      .map((path) => readJsonPath(remote, path))
      .find((value) => value !== undefined && value !== null && value !== "");
    const values = Array.isArray(selected)
      ? selected
      : selected === undefined
        ? []
        : [selected];
    return values.flatMap((value): RemoteArtifact[] => {
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
      const url = relativePath(value, config.output.urlPath ?? "url");
      const base64 = relativePath(value, config.output.base64Path);
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
        return [
          {
            kind: config.output.kind,
            data: new Uint8Array(Buffer.from(base64, "base64")),
            ...(typeof mimeType === "string"
              ? { mimeType }
              : config.output.defaultMimeType
                ? { mimeType: config.output.defaultMimeType }
                : {}),
            ...(typeof filename === "string" ? { filename } : {}),
          },
        ];
      }
      return [];
    });
  }
}

/** Naming aliases used by connector configuration/UI code. */
export const GenericRestConnector = GenericRestAdapter;
export const RestConnector = GenericRestAdapter;
