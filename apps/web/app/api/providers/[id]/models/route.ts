import { supplierKeyForConnection } from "../../../../../lib/supplier-identity";
import { randomUUID } from "node:crypto";
import { SupplierConflictError } from "@super-canvas/db";
import {
  assertCurrentSupplierConnection,
  SupplierServiceError,
} from "../../../../../lib/supplier-service";
import { matchesSupplierTemplate, SUPPLIER_TEMPLATE_API_URLS } from "../../../../../lib/supplier-template-source";
import {
  decryptSecret,
  fetchProviderJson,
  joinUrl,
  providerFetch,
  scanProviderModelCatalog,
  ProviderHttpError,
  type ModelDescriptor,
} from "@super-canvas/providers";
import { getRunService, type RunService } from "@super-canvas/runtime";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { requireServerMasterKey } from "../../../../../lib/master-key";
import { repository, jsonError } from "../../../../../lib/server";
import {
  loadCangyuanCatalog,
  syncCangyuanConnection,
} from "../../../../../lib/cangyuan-catalog";
import { scanCyberAfeiConnection } from "../../../../../lib/cyberafei-server";
import { CHENTU_PRESET_ID } from "../../../../../lib/chentu-presets";
import { scanChentuConnection } from "../../../../../lib/chentu-server";
import {
  FRIMODEL_PLATFORM_GROUPS,
  FRIMODEL_PRESET_ID,
  friModelFallbackImageDescriptor,
  friModelMarketplaceGroup,
} from "../../../../../lib/frimodel-presets";
import { scanFriModelConnection } from "../../../../../lib/frimodel-server";
import { scanMikotoConnection } from "../../../../../lib/mikoto-server";
import { bindScannedModelProtocols } from "../../../../../lib/scanned-model-protocols";
import { enrichSupplierModelPrices } from "../../../../../lib/supplier-model-pricing";
import { MIAOWU_PRESET_ID } from "../../../../../lib/miaowu-presets";
import { scanMiaowuConnection } from "../../../../../lib/miaowu-server";
import { CANGYUAN_IMAGE_PRESET_ID } from "../../../../../lib/provider-presets";
import {
  applyWeAiLivePricing,
  readWeAiSavedModelScan,
  weAiCanvasModelDescriptorsFromSavedScan,
  type WeAiLiveGroupPricing,
} from "../../../../../lib/weai-catalog";
import { liveWeAiPricingForGroup } from "../../../../../lib/weai-pricing-server";
import { isWeAiConnectionConfig } from "../../../../../lib/provider-connection-options";
import {
  manualProviderModelDescriptors,
  mergeManualProviderModels,
} from "../../../../../lib/manual-provider-models";

function adapterFor(service: RunService, provider: string) {
  const anyService = service as unknown as {
    adapters?: () => Map<string, unknown>;
  };
  return anyService.adapters?.()?.get(provider);
}

interface OpenAIModelList {
  data?: Array<{ id?: unknown; name?: unknown }>;
  models?: Array<{ id?: unknown; name?: unknown }>;
}

function modelListItems(payload: OpenAIModelList): Array<{
  id?: unknown;
  name?: unknown;
}> {
  // A few OpenAI-compatible gateways return both fields, with `data` left as
  // an empty array. Prefer the non-empty field so the useful inventory is not
  // discarded just because the response shape is technically valid.
  if (Array.isArray(payload.data) && payload.data.length > 0)
    return payload.data;
  if (Array.isArray(payload.models) && payload.models.length > 0)
    return payload.models;
  return Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
}

interface CustomGroupModelScan {
  models: ModelDescriptor[];
  groups: Array<{ id: string; label: string; modelIds: readonly string[] }>;
  checkedAt: string;
}

async function listCustomGroupModels(connection: {
  encryptedSecret?: string | null;
  config: Record<string, unknown>;
}): Promise<CustomGroupModelScan> {
  const baseUrl =
    typeof connection.config.baseUrl === "string"
      ? connection.config.baseUrl.trim()
      : "";
  if (!baseUrl) throw new Error("missing base URL");
  if (!connection.encryptedSecret) throw new Error("missing API key");
  const apiKey = decryptSecret(
    connection.encryptedSecret,
    requireServerMasterKey(),
  );
  const nativeProtocol = String(
    connection.config.directorProtocol ?? connection.config.protocol ?? "",
  );
  const nativeHeaders: Record<string, string> =
    nativeProtocol === "anthropic-messages"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : nativeProtocol === "google-generate-content"
        ? { "x-goog-api-key": apiKey }
        : { authorization: `Bearer ${apiKey}` };
  const candidates = [
    joinUrl(baseUrl, "/models"),
    joinUrl(
      baseUrl,
      nativeProtocol === "google-generate-content"
        ? "/v1beta/models"
        : "/v1/models",
    ),
  ].filter((url, index, all) => all.indexOf(url) === index);
  let payload: OpenAIModelList | undefined;
  let successfulPayload: OpenAIModelList | undefined;
  let lastError: unknown;
  for (const url of candidates) {
    try {
      const candidate = await fetchProviderJson<OpenAIModelList>(
        providerFetch,
        url,
        {
          method: "GET",
          headers: nativeHeaders,
          cache: "no-store",
        },
        {
          phase: "connect",
          timeoutMs: 20_000,
          allowLoopback: connection.config.allowLocalhost === true,
        },
      );
      successfulPayload ??= candidate;
      if (
        Array.isArray(candidate.data) ||
        Array.isArray(candidate.models) ||
        url === candidates[candidates.length - 1]
      ) {
        payload = candidate;
        break;
      }
    } catch (error) {
      if (
        error instanceof ProviderHttpError &&
        (error.details.status === 401 || error.details.status === 403)
      )
        throw error;
      lastError = error;
    }
  }
  payload ??= successfulPayload;
  if (!payload) throw lastError ?? new Error("model list unavailable");
  const defaultModel =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel.trim()
      : "";
  return scanProviderModelCatalog(payload, { defaultModel });
}

async function persistCustomGroupModelScan(
  connection: NonNullable<Awaited<ReturnType<typeof repository.getConnection>>>,
  scan: CustomGroupModelScan,
): Promise<void> {
  const latest = await repository.getConnection(connection.id);
  if (
    !latest ||
    latest.updatedAt !== connection.updatedAt ||
    latest.encryptedSecret !== connection.encryptedSecret
  )
    return;
  const modelIds = [...new Set(scan.models.map((model) => model.id))];
  const configuredDefault =
    typeof latest.config.defaultModel === "string"
      ? latest.config.defaultModel.trim()
      : "";
  const effectiveDefault = modelIds.includes(configuredDefault)
    ? configuredDefault
    : (scan.models.find((model) => model.isDefault)?.id ?? modelIds[0]);
  const modelGroups = Object.fromEntries(
    scan.groups.map((group) => [group.id, [...group.modelIds]]),
  );
  await repository.saveConnection(
    {
      id: latest.id,
      name: latest.name,
      provider: latest.provider,
      encryptedSecret: latest.encryptedSecret,
      config: {
        ...latest.config,
        modelScanStatus: modelIds.length > 0 ? "live" : "empty",
        modelScanCheckedAt: scan.checkedAt,
        scannedModelIds: modelIds,
        modelScanGroups: modelGroups,
        modelCatalogModels: scan.models,
        modelCatalogSource: "live",
        ...(effectiveDefault ? { defaultModel: effectiveDefault } : {}),
      },
    },
    { expected: connection },
  );
}

async function persistCustomGroupScanFailure(
  connection: NonNullable<Awaited<ReturnType<typeof repository.getConnection>>>,
  status: "failed" | "unauthorized" = "failed",
): Promise<void> {
  const latest = await repository.getConnection(connection.id);
  if (
    !latest ||
    latest.updatedAt !== connection.updatedAt ||
    latest.encryptedSecret !== connection.encryptedSecret
  )
    return;
  await repository.saveConnection(
    {
      id: latest.id,
      name: latest.name,
      provider: latest.provider,
      encryptedSecret: latest.encryptedSecret,
      config: {
        ...latest.config,
        // A transient failure cannot undo an explicit denial for the same key.
        modelScanStatus:
          status === "failed" &&
          latest.config.modelScanStatus === "unauthorized"
            ? "unauthorized"
            : status,
        modelScanCheckedAt: new Date().toISOString(),
        modelCatalogSource: "saved",
      },
    },
    { expected: connection },
  );
}

function configuredStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : [],
  );
}

function savedConnectorModels(connection: {
  config: Record<string, unknown>;
}, preferConnector = false): ModelDescriptor[] {
  const connector = connection.config.connector;
  const configuredCatalog = connection.config.modelCatalogModels;
  const models = !preferConnector && Array.isArray(configuredCatalog)
    ? configuredCatalog
    : connector && typeof connector === "object" && !Array.isArray(connector)
      ? (connector as Record<string, unknown>).models
      : undefined;
  if (!Array.isArray(models)) return [];
  return models.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const model = value as Record<string, unknown>;
    if (typeof model.id !== "string" || !model.id.trim()) return [];
    return [
      {
        ...(model as unknown as ModelDescriptor),
        id: model.id.trim(),
        name:
          typeof model.name === "string" && model.name.trim()
            ? model.name
            : model.id.trim(),
        operations: Array.isArray(model.operations) ? model.operations : [],
      },
    ];
  });
}

function staleModelsResponse(
  items: readonly ModelDescriptor[],
  headers: Record<string, string> = {},
) {
  return Response.json([...items], {
    headers: {
      "Cache-Control": "no-store",
      ...headers,
      "X-Model-Scan-Status": "stale",
      "X-Model-Scan-Warning": "upstream-temporary-failure-last-success",
    },
  });
}

function agentModelsFromMarketplaceGroup(
  group:
    | {
        models?: Array<{
          id: string;
          name: string;
          description?: string;
          capability: string;
          priceLabel?: string;
          billingLabel?: string;
          tags?: readonly string[];
          endpointTypes?: readonly string[];
        }>;
      }
    | null
    | undefined,
  defaultModel: string,
): ModelDescriptor[] {
  return (group?.models ?? [])
    .filter((model) => model.capability === "chat")
    .map((model): ModelDescriptor => ({
      id: model.id,
      name: model.name,
      description: model.description,
      operations: [],
      provider: "openai",
      capabilities: [],
      inputKinds: ["text"],
      outputKinds: ["text"],
      isDefault: model.id === defaultModel,
      ...(model.priceLabel ||
      model.billingLabel ||
      model.tags?.length ||
      model.endpointTypes?.length
        ? {
            metadata: {
              ...(model.priceLabel ? { priceLabel: model.priceLabel } : {}),
              ...(model.billingLabel
                ? { billingLabel: model.billingLabel }
                : {}),
              ...(model.tags?.length ? { tags: model.tags } : {}),
              ...(model.endpointTypes?.length
                ? { endpointTypes: model.endpointTypes }
                : {}),
              catalogSource: "cangyuan-marketplace",
            },
          }
        : {}),
    }));
}

function savedFriModelSnapshotModels(connection: {
  config: Record<string, unknown>;
}): ModelDescriptor[] {
  const groupId =
    typeof connection.config.modelGroup === "string"
      ? connection.config.modelGroup
      : "";
  const group = friModelMarketplaceGroup(groupId);
  if (!group) return [];
  const scanned = new Set(configuredStrings(connection.config.scannedModelIds));
  const models =
    scanned.size > 0
      ? group.models.filter((model) => scanned.has(model.id))
      : group.models;
  return models.map((model) => {
    const imageFallback =
      model.capability === "image"
        ? friModelFallbackImageDescriptor(model.id, groupId)
        : undefined;
    return {
      ...(imageFallback ?? {
        id: model.id,
        description: model.description,
        operations:
          model.capability === "video"
            ? ["video.generate", "video.image-to-video"]
            : model.capability === "image"
              ? ["image.generate"]
              : [],
        inputKinds: model.capability === "image" ? ["text"] : ["text"],
        outputKinds: [
          model.capability === "video"
            ? "video"
            : model.capability === "image"
              ? "image"
              : "text",
        ],
      }),
      name: `${model.name}（${model.priceLabel}·快照）`,
      metadata: {
        ...(imageFallback?.metadata ?? {}),
        canvasRunnable:
          group.canvasSupported &&
          (model.capability === "image" || model.capability === "video"),
        priceLabel: model.priceLabel,
        billingLabel: "价格快照",
      },
    };
  });
}

async function persistWeAiModelScan(
  connection: NonNullable<Awaited<ReturnType<typeof repository.getConnection>>>,
  items: readonly ModelDescriptor[],
  livePricing?: WeAiLiveGroupPricing,
): Promise<void> {
  const latest = await repository.getConnection(connection.id);
  if (
    !latest ||
    latest.updatedAt !== connection.updatedAt ||
    latest.encryptedSecret !== connection.encryptedSecret
  )
    return;
  const modelIds = [...new Set(items.map((model) => model.id))];
  const configuredDefault =
    typeof latest.config.defaultModel === "string"
      ? latest.config.defaultModel
      : "";
  const effectiveDefault = modelIds.includes(configuredDefault)
    ? configuredDefault
    : (items.find((model) => model.isDefault)?.id ?? modelIds[0]);
  const config = {
    ...latest.config,
    modelScanStatus: modelIds.length > 0 ? "live" : "empty",
    modelScanCheckedAt: new Date().toISOString(),
    scannedModelIds: modelIds,
    ...(livePricing ? { weAiLivePricing: livePricing } : {}),
    ...(effectiveDefault ? { defaultModel: effectiveDefault } : {}),
  };
  await repository.saveConnection(
    {
      id: latest.id,
      name: latest.name,
      provider: latest.provider,
      encryptedSecret: latest.encryptedSecret,
      config,
    },
    { expected: connection },
  );
}

/**
 * Marks snapshot models missing from the key's live scan as non-runnable and
 * appends key-visible ids that have no built-in protocol yet, so the settings
 * UI and canvas selector reflect real availability without touching prices.
 */
function annotateScannedAvailability(
  items: readonly ModelDescriptor[],
  config: Readonly<Record<string, unknown>>,
): ModelDescriptor[] {
  const unavailable = new Set(configuredStrings(config.unavailableModels));
  const unknown = configuredStrings(config.unknownModels);
  if (unavailable.size === 0 && unknown.length === 0) return [...items];
  const result: ModelDescriptor[] = items.map((model) =>
    unavailable.has(model.id)
      ? {
          ...model,
          metadata: {
            ...(model.metadata ?? {}),
            canvasRunnable: false,
            canvasUnavailableReason:
              "当前分组 Key 的实时扫描未返回该模型（可能已下架或无权限）",
          },
        }
      : model,
  );
  // Key-visible chat/LLM ids are real scan results but useless in an
  // image/video group's canvas dropdown — keep them out of the appended list.
  const chatLike =
    /^(?:gpt-\d|gpt-4o|chatgpt|codex|claude|o\d|deepseek|kimi|glm|grok-\d)|audio-preview|realtime|chat-latest/iu;
  const present = new Set(items.map((model) => model.id));
  for (const id of unknown) {
    if (present.has(id) || chatLike.test(id)) continue;
    const discovered = scanProviderModelCatalog({ data: [{ id }] }).models[0]!;
    result.push({
      id,
      name: `${id}（价格以平台为准）`,
      description: "当前分组 Key 可见、但内置目录尚未收录的模型。",
      operations: discovered.operations,
      inputKinds: discovered.inputKinds,
      outputKinds: discovered.outputKinds,
      metadata: {
        priceLabel: "价格以平台为准",
        canvasRunnable: false,
        canvasUnavailableReason:
          "该模型在当前 Key 下可见，但画布协议尚未内置；请选择已内置模型",
      },
    });
  }
  return result;
}

/**
 * FriModel exposes no machine-readable pricing; append the documented
 * snapshot price to each live-scanned model so the selector still shows a
 * unified price. Models without a snapshot entry show 价格以平台为准.
 */
function annotateFriModelPrices(
  items: readonly ModelDescriptor[],
): ModelDescriptor[] {
  const snapshotPrices = new Map(
    FRIMODEL_PLATFORM_GROUPS.flatMap((group) =>
      group.models.map((model) => [model.id, model.priceLabel] as const),
    ),
  );
  return items.map((model) => {
    const priceLabel = snapshotPrices.get(model.id) ?? "价格以平台为准";
    return {
      ...model,
      name: `${model.id}（${priceLabel}·快照）`,
      metadata: {
        ...(model.metadata ?? {}),
        priceLabel,
        billingLabel: "价格快照",
      },
    };
  });
}

async function listAgentModels(connection: {
  encryptedSecret?: string | null;
  config: Record<string, unknown>;
}): Promise<ModelDescriptor[]> {
  const baseUrl =
    typeof connection.config.baseUrl === "string"
      ? connection.config.baseUrl.trim()
      : "";
  if (!baseUrl) throw new Error("missing base URL");
  if (!connection.encryptedSecret) throw new Error("missing API key");
  const apiKey = decryptSecret(
    connection.encryptedSecret,
    requireServerMasterKey(),
  );
  const nativeProtocol = String(
    connection.config.directorProtocol ?? connection.config.protocol ?? "",
  );
  const nativeHeaders: Record<string, string> =
    nativeProtocol === "anthropic-messages"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : nativeProtocol === "google-generate-content"
        ? { "x-goog-api-key": apiKey }
        : { authorization: `Bearer ${apiKey}` };
  const candidates = [
    joinUrl(baseUrl, "/models"),
    joinUrl(
      baseUrl,
      nativeProtocol === "google-generate-content"
        ? "/v1beta/models"
        : "/v1/models",
    ),
  ].filter((url, index, all) => all.indexOf(url) === index);
  let response: OpenAIModelList | undefined;
  let successfulResponse: OpenAIModelList | undefined;
  let lastError: unknown;
  for (const url of candidates) {
    try {
      const payload = await fetchProviderJson<OpenAIModelList>(
        providerFetch,
        url,
        {
          method: "GET",
          headers: nativeHeaders,
          cache: "no-store",
        },
        {
          phase: "connect",
          timeoutMs: 20_000,
          allowLoopback: connection.config.allowLocalhost === true,
        },
      );
      successfulResponse ??= payload;
      const items = modelListItems(payload);
      if (
        Array.isArray(payload.data) ||
        Array.isArray(payload.models) ||
        url === candidates[candidates.length - 1]
      ) {
        response = payload;
        break;
      }
    } catch (error) {
      if (
        error instanceof ProviderHttpError &&
        (error.details.status === 401 || error.details.status === 403)
      )
        throw error;
      lastError = error;
    }
  }
  response ??= successfulResponse;
  if (!response) throw lastError ?? new Error("model list unavailable");
  const responseItems = modelListItems(response);
  const available = new Set(
    responseItems.flatMap((item) =>
      typeof item.id === "string" && item.id.trim() ? [item.id.trim()] : [],
    ),
  );
  const allowed = configuredStrings(connection.config.allowedModels);
  const ids = (allowed.length > 0 ? allowed : [...available]).filter(
    (id) =>
      available.has(id) &&
      id !== "codex-auto-review" &&
      !id.toLowerCase().includes("image"),
  );
  const defaultModel =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel.trim()
      : "";
  const names =
    connection.config.modelNames &&
    typeof connection.config.modelNames === "object" &&
    !Array.isArray(connection.config.modelNames)
      ? (connection.config.modelNames as Record<string, unknown>)
      : {};
  return ids.map((id) => ({
    id,
    name: typeof names[id] === "string" ? names[id] : id,
    operations: [],
    provider: "openai",
    capabilities: [],
    inputKinds: ["text"],
    outputKinds: ["text"],
    isDefault: id === defaultModel,
  }));
}

async function readModels(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  const searchParams = new URL(request.url).searchParams;
  const refresh = searchParams.get("refresh") === "1";
  let connection = await repository.getConnection(id);
  if (!connection) return jsonError("供应商连接不存在", 404);
  const alternateSource =
    !matchesSupplierTemplate(connection) &&
    Boolean(connection.config.preset || SUPPLIER_TEMPLATE_API_URLS[supplierKeyForConnection(connection)]);

  if (!alternateSource && connection.config.preset === "cyberafei-api") {
    const scan = await scanCyberAfeiConnection(id, {
      forcePricing: refresh,
      persist: refresh,
    });
    const headers = {
      "Cache-Control": "no-store",
      "X-Model-Scan-Status": scan.status,
      "X-Model-Scan-Checked-At": scan.checkedAt,
    };
    if (scan.status === "unauthorized")
      return Response.json(
        { error: scan.error ?? "赛博阿飞分组 Key 无权读取模型" },
        { status: 401, headers },
      );
    if (scan.status === "unconfigured")
      return Response.json(
        { error: scan.error ?? "赛博阿飞分组尚未配置 Key" },
        { status: 409, headers },
      );
    if (scan.status === "failed") {
      const stale =
        scan.connection?.config.usage === "agent"
          ? agentModelsFromMarketplaceGroup(
              scan.marketplaceGroup,
              typeof scan.connection.config.defaultModel === "string"
                ? scan.connection.config.defaultModel
                : "",
            )
          : scan.canvasDisplayModels;
      if (stale.length > 0) return staleModelsResponse(stale, headers);
    }
    if (scan.status === "failed")
      return Response.json(
        { error: scan.error ?? "赛博阿飞模型扫描失败" },
        { status: 502, headers },
      );
    if (scan.connection?.config.usage === "agent") {
      const defaultModel =
        typeof scan.connection.config.defaultModel === "string"
          ? scan.connection.config.defaultModel
          : "";
      const models = (scan.marketplaceGroup?.models ?? [])
        .filter((model) => model.capability === "chat")
        .map((model): ModelDescriptor => ({
          id: model.id,
          name: model.name,
          description: model.description,
          operations: [],
          provider: "openai",
          capabilities: [],
          inputKinds: ["text"],
          outputKinds: ["text"],
          isDefault: model.id === defaultModel,
        }));
      return Response.json(models, { headers });
    }
    return Response.json(scan.canvasDisplayModels, { headers });
  }
  if (!alternateSource && connection.config.preset === CHENTU_PRESET_ID) {
    const scan = await scanChentuConnection(id, {
      forcePricing: refresh,
      persist: refresh,
    });
    const headers = {
      "Cache-Control": "no-store",
      "X-Model-Scan-Status": scan.status,
      "X-Model-Scan-Checked-At": scan.checkedAt,
    };
    if (scan.status === "unauthorized")
      return Response.json(
        { error: scan.error ?? "辰途分组 Key 无权读取模型" },
        { status: 401, headers },
      );
    if (scan.status === "unconfigured")
      return Response.json(
        { error: scan.error ?? "辰途分组尚未配置 Key" },
        { status: 409, headers },
      );
    if (scan.status === "failed") {
      const stale =
        scan.connection?.config.usage === "agent"
          ? agentModelsFromMarketplaceGroup(
              scan.marketplaceGroup,
              typeof scan.connection.config.defaultModel === "string"
                ? scan.connection.config.defaultModel
                : "",
            )
          : scan.canvasDisplayModels;
      if (stale.length > 0) return staleModelsResponse(stale, headers);
    }
    if (scan.status === "failed")
      return Response.json(
        { error: scan.error ?? "辰途模型扫描失败" },
        { status: 502, headers },
      );
    if (scan.connection?.config.usage === "agent") {
      const defaultModel =
        typeof scan.connection.config.defaultModel === "string"
          ? scan.connection.config.defaultModel
          : "";
      const models = (scan.marketplaceGroup?.models ?? [])
        .filter((model) => model.capability === "chat")
        .map((model): ModelDescriptor => ({
          id: model.id,
          name: model.name,
          description: model.description,
          operations: [],
          provider: "openai",
          capabilities: [],
          inputKinds: ["text"],
          outputKinds: ["text"],
          isDefault: model.id === defaultModel,
        }));
      return Response.json(models, { headers });
    }
    return Response.json(scan.canvasDisplayModels, { headers });
  }
  if (!alternateSource && connection.config.preset === MIAOWU_PRESET_ID) {
    const scan = await scanMiaowuConnection(id, {
      forcePricing: refresh,
      persist: refresh,
    });
    const scanHeaders = {
      "Cache-Control": "no-store",
      "X-Model-Scan-Status": scan.status,
      "X-Model-Scan-Checked-At": scan.checkedAt,
    };
    if (scan.status === "unauthorized")
      return Response.json(
        { error: scan.error ?? "喵呜分组 Key 无权读取模型" },
        { status: 401, headers: scanHeaders },
      );
    if (scan.status === "failed") {
      const stale = savedConnectorModels(scan.connection ?? connection);
      if (stale.length > 0) return staleModelsResponse(stale, scanHeaders);
      return Response.json(
        { error: scan.error ?? "喵呜模型扫描失败" },
        { status: 502, headers: scanHeaders },
      );
    }
    if (scan.status === "live" || scan.status === "empty") {
      connection = scan.connection ?? connection;
      const connector = connection.config.connector as
        { models?: ModelDescriptor[] } | undefined;
      return Response.json(connector?.models ?? [], { headers: scanHeaders });
    }
    // unconfigured：尚未保存 Key，继续展示价目目录里的模型信息。
  }
  if (
    !alternateSource &&
    connection.config.preset === FRIMODEL_PRESET_ID &&
    refresh
  ) {
    // 免费的 /models 扫描：把可用性字段持久化给设置界面；模型列表本身
    // 由下方 openai 适配器的实时列举返回。
    const scan = await scanFriModelConnection(id).catch(() => undefined);
    if (scan?.status === "unauthorized")
      return Response.json(
        { error: scan.error ?? "FriModel 分组 Key 无权读取模型" },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
            "X-Model-Scan-Status": scan.status,
            "X-Model-Scan-Checked-At": scan.checkedAt,
          },
        },
      );
    connection = (await repository.getConnection(id)) ?? connection;
    if (scan?.status === "failed") {
      const stale = savedFriModelSnapshotModels(connection);
      if (stale.length > 0) return staleModelsResponse(stale);
    }
  }
  let mikotoScanHeaders: Record<string, string> = {};
  if (!alternateSource && connection.config.preset === "mikoto-pro") {
    const scan = await scanMikotoConnection(id, {
      force: refresh,
      persist: refresh,
    });
    mikotoScanHeaders = {
      "X-Model-Scan-Status": scan.status,
      "X-Model-Scan-Checked-At": scan.checkedAt,
    };
    if (scan.status === "unauthorized")
      return Response.json(
        {
          error:
            scan.error ??
            "MikotoPro 拒绝了当前分组 Key（可能分组已停用），请在官网确认后重新填写",
        },
        {
          status: 401,
          headers: { "Cache-Control": "no-store", ...mikotoScanHeaders },
        },
      );
    connection = scan.connection ?? connection;
    if (scan.status === "failed") {
      const stale = savedConnectorModels(connection);
      if (stale.length > 0)
        return staleModelsResponse(stale, mikotoScanHeaders);
    }
  }
  if (connection.config.customGroup === true || alternateSource) {
    try {
      const scan = await listCustomGroupModels(connection);
      if (refresh) await persistCustomGroupModelScan(connection, scan);
      return Response.json(
        mergeManualProviderModels(
          {
            ...connection,
            config: {
              ...connection.config,
              modelScanStatus: scan.models.length ? "live" : "empty",
            },
          },
          scan.models,
          true,
        ),
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Model-Scan-Status": scan.models.length > 0 ? "live" : "empty",
            "X-Model-Scan-Checked-At": scan.checkedAt,
            "X-Model-Scan-Source": "live",
          },
        },
      );
    } catch (error) {
      if (
        error instanceof ProviderHttpError &&
        (error.details.status === 401 || error.details.status === 403)
      ) {
        if (refresh)
          await persistCustomGroupScanFailure(connection, "unauthorized");
        return Response.json(
          { error: "当前分组 Key 无权读取模型，请重新配置密钥" },
          {
            status: error.details.status,
            headers: {
              "X-Model-Scan-Status": "unauthorized",
              "Cache-Control": "no-store",
            },
          },
        );
      }
      if (refresh)
        void persistCustomGroupScanFailure(connection).catch(() => undefined);
      const stale = mergeManualProviderModels(
        connection,
        connection.config.modelScanStatus === "live" ||
          connection.config.modelScanStatus === "failed"
          ? savedConnectorModels(connection)
          : [],
      );
      if (stale.length > 0)
        return staleModelsResponse(stale, {
          "X-Model-Scan-Source": "saved",
        });
      return jsonError(
        "自定义分组模型列表读取失败，请检查 Base URL、密钥和接口路径",
        502,
      );
    }
  }
  if (refresh && connection.config.preset === CANGYUAN_IMAGE_PRESET_ID) {
    const scan = await listCustomGroupModels(connection);
    if (!scan.models.length)
      return Response.json([], { headers: { "X-Model-Scan-Status": "empty" } });
    if (connection.config.usage === "agent")
      return Response.json(scan.models, {
        headers: { "X-Model-Scan-Status": "live" },
      });
    connection = (await syncCangyuanConnection(id)) ?? connection;
    const configured = savedConnectorModels(connection, true);
    const byId = new Map(configured.map((m) => [m.id, m]));
    return Response.json(
      scan.models.map(
        (m) =>
          byId.get(m.id) ?? {
            ...m,
            metadata: {
              ...m.metadata,
              canvasRunnable: false,
              canvasUnavailableReason: "此模型已扫描到，但生成协议尚未验证",
            },
          },
      ),
      { headers: { "X-Model-Scan-Status": "live" } },
    );
  }
  // A normal model read is strictly read-only. Explicit refresh may reconcile
  // a preset catalog, but that operation is isolated to the requested
  // connection and never runs as a side effect of canvas initialization.
  if (refresh && connection.config.preset === "cangyuan-gpt-image-2")
    connection = (await syncCangyuanConnection(id)) ?? connection;

  // Director connections use a Cangyuan LLM group for reasoning. Those
  // groups are published in the supplier's model plaza, while the generic
  // OpenAI-compatible `/models` endpoint may be empty or image-only. Read
  // the selected marketplace group so every model in the configured group is
  // available to the director selector without changing the saved connection.
  if (
    connection.config.preset === CANGYUAN_IMAGE_PRESET_ID &&
    connection.config.usage === "agent"
  ) {
    const catalog = await loadCangyuanCatalog();
    const groupId =
      typeof connection.config.modelGroup === "string"
        ? connection.config.modelGroup.trim()
        : typeof connection.config.group === "string"
          ? connection.config.group.trim()
          : "";
    const group = catalog.marketplaceGroups.find((item) => item.id === groupId);
    const defaultModel =
      typeof connection.config.defaultModel === "string"
        ? connection.config.defaultModel.trim()
        : "";
    const models = agentModelsFromMarketplaceGroup(group, defaultModel);
    if (models.length > 0) {
      return Response.json(models, {
        headers: {
          "Cache-Control": "no-store",
          "X-Model-Scan-Status": catalog.source === "live" ? "live" : "stale",
          "X-Model-Scan-Source": "cangyuan-marketplace",
          "X-Model-Scan-Checked-At": catalog.checkedAt,
        },
      });
    }
  }
  if (isWeAiConnectionConfig(connection) && !refresh) {
    const savedModels = weAiCanvasModelDescriptorsFromSavedScan(
      connection.config,
    );
    const savedScan = readWeAiSavedModelScan(connection.config);
    if (savedModels && savedScan) {
      // A saved key scan is authoritative for availability, but its embedded
      // pricing can be stale. Refresh the supplier's model-plaza prices while
      // retaining the saved scan IDs so a price change reaches the canvas
      // without requiring another authenticated model scan.
      const livePricing = await liveWeAiPricingForGroup(
        connection.config.modelGroup,
        connection.config.baseUrl,
        `${connection.id}:${connection.config.modelScanRequestId ?? ""}`,
      ).catch(() => undefined);
      const pricedModels = livePricing
        ? applyWeAiLivePricing(savedModels, livePricing)
        : savedModels;
      return Response.json(pricedModels, {
        headers: {
          "Cache-Control": "no-store",
          "X-Model-Scan-Status": savedScan.status,
          ...(savedScan.checkedAt
            ? { "X-Model-Scan-Checked-At": savedScan.checkedAt }
            : {}),
          "X-Model-Scan-Source": "saved",
          ...(livePricing
            ? {
                "X-WeAI-Pricing-Source": livePricing.source,
                "X-WeAI-Pricing-Checked-At": livePricing.checkedAt,
              }
            : {}),
        },
      });
    }
  }
  if (connection.config.usage === "agent") {
    try {
      return Response.json(
        mergeManualProviderModels(
          connection,
          await listAgentModels(connection),
          true,
        ),
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (error) {
      if (
        error instanceof ProviderHttpError &&
        (error.details.status === 401 || error.details.status === 403)
      )
        return jsonError("当前分组 Key 无权读取模型", error.details.status);
      const manual = manualProviderModelDescriptors(connection);
      if (manual.length)
        return staleModelsResponse(manual, { "X-Model-Scan-Source": "manual" });
      return jsonError("对话模型列表读取失败，请检查地址、密钥和模型权限", 502);
    }
  }
  const adapter = adapterFor(getRunService(), connection.provider);
  if (!adapter || typeof adapter !== "object" || !("listModels" in adapter))
    return jsonError("供应商适配器不可用", 422);
  try {
    const pricingRequest = isWeAiConnectionConfig(connection)
      ? liveWeAiPricingForGroup(
          connection.config.modelGroup,
          connection.config.baseUrl,
          `${connection.id}:${connection.config.modelScanRequestId ?? ""}`,
        ).catch(() => undefined)
      : Promise.resolve(undefined);
    const [listedItems, livePricing] = await Promise.all([
      (
        adapter as { listModels: (id: string) => Promise<ModelDescriptor[]> }
      ).listModels(id) as Promise<ModelDescriptor[]>,
      pricingRequest,
    ]);
    const priced = isWeAiConnectionConfig(connection)
      ? applyWeAiLivePricing(listedItems, livePricing)
      : listedItems;
    if (isWeAiConnectionConfig(connection) && refresh)
      await persistWeAiModelScan(connection, priced, livePricing);
    const items =
      connection.config.preset === "mikoto-pro"
        ? annotateScannedAvailability(priced, connection.config)
        : connection.config.preset === FRIMODEL_PRESET_ID
          ? annotateFriModelPrices(priced)
          : priced;
    return Response.json(mergeManualProviderModels(connection, items, true), {
      headers: {
        "Cache-Control": "no-store",
        ...mikotoScanHeaders,
        ...(isWeAiConnectionConfig(connection)
          ? {
              "X-Model-Scan-Status": items.length > 0 ? "live" : "empty",
              "X-Model-Scan-Source": "live",
              ...(livePricing
                ? {
                    "X-WeAI-Pricing-Source": livePricing.source,
                    "X-WeAI-Pricing-Checked-At": livePricing.checkedAt,
                  }
                : {}),
            }
          : {}),
      },
    });
  } catch (error) {
    if (
      error instanceof ProviderHttpError &&
      (error.details.status === 401 || error.details.status === 403)
    )
      return jsonError("当前分组 Key 无权读取模型", error.details.status);
    const connectorSnapshot = savedConnectorModels(connection);
    const weAiSnapshot = isWeAiConnectionConfig(connection)
      ? (weAiCanvasModelDescriptorsFromSavedScan(connection.config) ?? [])
      : [];
    const stale =
      connectorSnapshot.length > 0 &&
      connection.config.modelScanStatus === "live"
        ? connectorSnapshot
        : weAiSnapshot.length > 0
          ? weAiSnapshot
          : connection.config.preset === FRIMODEL_PRESET_ID
            ? savedFriModelSnapshotModels(connection)
            : [];
    if (stale.length > 0)
      return staleModelsResponse(stale, {
        ...mikotoScanHeaders,
        ...(connection.config.preset === FRIMODEL_PRESET_ID
          ? { "X-Model-Scan-Source": "snapshot" }
          : isWeAiConnectionConfig(connection)
            ? { "X-Model-Scan-Source": "saved" }
            : {}),
      });
    const manual = manualProviderModelDescriptors(connection);
    if (manual.length)
      return staleModelsResponse(manual, { "X-Model-Scan-Source": "manual" });
    return jsonError("模型列表读取失败，请检查供应商连接", 502);
  }
}

/** One request identity across every adapter prevents delayed results from restoring old state. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedId = parseRouteIdentifier((await context.params).id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  let original = await repository.getConnection(id);
  if (!original) return jsonError("供应商连接已删除，请重新选择连接", 404);
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    await assertCurrentSupplierConnection(original);
    if (
      !refresh &&
      original.config.supplierSourceId &&
      (!original.config.modelScanStatus ||
        original.config.modelScanStatus === "unscanned") &&
      original.encryptedSecret
    ) {
      const url = new URL(request.url);
      url.searchParams.set("refresh", "1");
      return GET(new Request(url), context);
    }

    if (refresh)
      original = await repository.saveConnection(
        {
          ...original,
          config: { ...original.config, modelScanRequestId: randomUUID() },
        },
        { expected: original },
      );
    const requestId = original.config.modelScanRequestId;
    if (!refresh && original.config.modelScanStatus === "unauthorized")
      return Response.json(
        { error: "当前 Key 鉴权失败，请更新 Key 或重新测试" },
        { status: 401, headers: { "X-Model-Scan-Status": "unauthorized" } },
      );
    if (!refresh && original.config.modelScanStatus === "empty")
      return Response.json([], {
        headers: {
          "X-Model-Scan-Status": "empty",
          "Cache-Control": "no-store",
        },
      });
    if (
      !refresh &&
      Array.isArray(original.config.modelCatalogModels) &&
      ["live", "failed"].includes(String(original.config.modelScanStatus))
    ) {
      // Cached inventories still contain the old protocol decisions after a
      // software update. Rebind those exact IDs without a new upstream scan.
      const cached = original.config.modelCatalogModels as unknown as ModelDescriptor[];
      const bound = bindScannedModelProtocols(original, await enrichSupplierModelPrices(original, cached));
      if (JSON.stringify(bound.models) !== JSON.stringify(cached)) {
        original = await repository.saveConnection({ ...original, config: {
          ...original.config,
          modelCatalogModels: bound.models as unknown as typeof original.config.modelCatalogModels,
          ...(bound.connector ? { connector: bound.connector as unknown as typeof original.config.connector,
            modelProtocolTemplate: bound.templateConnector as unknown as typeof original.config.connector } : {}),
        } }, { expected: original });
      }
      return Response.json(
        mergeManualProviderModels(original, bound.models),
        {
          headers: {
            "X-Model-Scan-Status":
              original.config.modelScanStatus === "failed" ? "stale" : "live",
            "Cache-Control": "no-store",
          },
        },
      );
    }
    const response = await readModels(request, context);
    let latest = await repository.getConnection(id);
    if (
      !latest ||
      latest.config.modelScanRequestId !== requestId ||
      latest.encryptedSecret !== original.encryptedSecret
    )
      throw new SupplierConflictError(
        "扫描期间连接已改变，旧结果已丢弃，请重新读取",
      );
    await assertCurrentSupplierConnection(latest);
    if (refresh) {
      const status = response.headers.get("X-Model-Scan-Status");
      const payload: unknown = response.ok
        ? await response
            .clone()
            .json()
            .catch(() => null)
        : null;
      let config = { ...latest.config };
      if (
        response.ok &&
        Array.isArray(payload) &&
        status !== "stale" &&
        status !== "failed"
      ) {
        const unavailable = (m: ModelDescriptor) =>
          m.metadata?.canvasRunnable === false &&
          String(m.metadata?.canvasUnavailableReason ?? "").includes("未返回");
        const visible = (payload as ModelDescriptor[]).filter(
          (m) => !unavailable(m),
        );
        const bound = bindScannedModelProtocols(latest, await enrichSupplierModelPrices(latest, visible, true), original);
        const models = bound.models;
        const defaultModel =
          models.find((m) => m.id === config.defaultModel && m.metadata?.canvasRunnable !== false) ??
          models.find((m) => m.metadata?.canvasRunnable !== false && m.operations.length > 0);
        config = {
          ...config,
          ...(bound.connector
            ? {
                connector: bound.connector as unknown as typeof config.connector,
                modelProtocolTemplate: bound.templateConnector as unknown as typeof config.connector,
              }
            : {}),
          ...(defaultModel ? { defaultModel: defaultModel.id } : {}),
          modelScanStatus: models.length ? "live" : "empty",
          modelScanCheckedAt: new Date().toISOString(),
          modelCatalogModels:
            models as unknown as typeof config.modelCatalogModels,
          scannedModelIds: models.map((m) => m.id),
          modelCatalogSource: "live",
        };
        latest = await repository.saveConnection(
          { ...latest, config },
          { expected: latest },
        );
        return Response.json(mergeManualProviderModels(latest, models, true), {
          headers: {
            "Cache-Control": "no-store",
            "X-Model-Scan-Status": models.length ? "live" : "empty",
          },
        });
      }
      config.modelScanStatus =
        response.status === 401 ||
        response.status === 403 ||
        status === "unauthorized"
          ? "unauthorized"
          : ["unauthorized", "empty"].includes(
                String(original.config.modelScanStatus),
              )
            ? original.config.modelScanStatus
            : config.modelScanStatus === "unauthorized"
              ? "unauthorized"
              : "failed";
      config.modelScanCheckedAt = new Date().toISOString();
      await repository.saveConnection(
        { ...latest, config },
        { expected: latest },
      );
    }
    if (response.ok) {
      const payload: unknown = await response.clone().json().catch(() => null);
      if (Array.isArray(payload)) {
        const models = await enrichSupplierModelPrices(latest, payload as ModelDescriptor[]);
        return Response.json(models, { headers: response.headers });
      }
    }
    return response;
  } catch (error) {
    if (
      error instanceof SupplierConflictError ||
      error instanceof SupplierServiceError
    )
      return jsonError(
        error.message,
        error instanceof SupplierServiceError ? error.status : 409,
      );
    try {
      const latest = await repository.getConnection(id);
      if (
        !latest ||
        latest.config.modelScanRequestId !==
          original.config.modelScanRequestId ||
        latest.encryptedSecret !== original.encryptedSecret
      )
        return jsonError("扫描期间连接已改变，旧结果已丢弃", 409);
      await assertCurrentSupplierConnection(latest);
      const denied =
        error instanceof ProviderHttpError &&
        [401, 403].includes(error.details.status ?? 0);
      const previousDenial = ["unauthorized", "empty"].includes(
        String(original.config.modelScanStatus),
      );
      const status = denied
        ? "unauthorized"
        : previousDenial
          ? original.config.modelScanStatus
          : "failed";
      const saved = await repository.saveConnection(
        {
          ...latest,
          config: {
            ...latest.config,
            modelScanStatus: status,
            modelScanCheckedAt: new Date().toISOString(),
          },
        },
        { expected: latest },
      );
      if (status === "unauthorized")
        return jsonError("当前 Key 鉴权失败，请重新配置或测试", 401);
      if (status === "empty") return staleModelsResponse([]);
      if (Array.isArray(saved.config.modelCatalogModels))
        return staleModelsResponse(
          mergeManualProviderModels(
            saved,
            saved.config.modelCatalogModels as unknown as ModelDescriptor[],
            true,
          ),
        );
    } catch (failure) {
      if (
        failure instanceof SupplierConflictError ||
        failure instanceof SupplierServiceError
      )
        return jsonError(
          failure.message,
          failure instanceof SupplierServiceError ? failure.status : 409,
        );
    }
    return jsonError("模型刷新失败，请稍后重试", 502);
  }
}
