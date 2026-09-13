import { normalizeSupplierSiteBase } from "@super-canvas/providers";
import { randomUUID } from "node:crypto";
import { SupplierConflictError } from "@super-canvas/db";
import {
  ProviderConnectionRequestSchema,
  parseJsonRequest,
} from "../../../lib/api-validation";
import {
  repository,
  jsonError,
  maskConnection,
  saveProviderConnection,
} from "../../../lib/server";
import { CHENTU_PRESET_ID } from "../../../lib/chentu-presets";
import { clearEmptyScanConfirmation } from "../../../lib/model-scan-confirmation";
import { supplierKeyForConnection } from "../../../lib/supplier-identity";
import {
  listSupplierRecords,
  assertCurrentSupplierConnection,
  supplierConfigForConnection,
  SupplierServiceError,
} from "../../../lib/supplier-service";
import {
  validateManualProviderModels,
  ManualModelValidationError,
} from "../../../lib/manual-provider-models";

export async function GET(_request?: Request) {
  void _request;
  // Reconcile legacy source ownership once, without fetching model catalogs.
  // A list read must never replace a saved connector or its default model.
  await listSupplierRecords();
  const connections = await repository.listConnections();
  return Response.json(
    connections
      .filter((c) => c.config.supplierArchived !== true)
      .map((connection) => maskConnection(connection)),
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    ProviderConnectionRequestSchema,
  );
  if (!parsed.success) return parsed.response;

  try {
    const config = { ...(parsed.data.config ?? {}) };
    const existing = parsed.data.id
      ? await repository.getConnection(parsed.data.id)
      : null;
    if (parsed.data.id && !existing)
      return jsonError("供应商连接不存在，不能使用旧连接 ID 创建新供应商", 404);
    // A connection owns exactly one supplier namespace. Updating its provider
    // or preset in-place could otherwise retain the old encrypted key when
    // apiKey is omitted, making credentials leak across suppliers. Switching
    // suppliers must always create a new connection.
    if (existing) {
      await assertCurrentSupplierConnection(existing);
      if (!existing.config.supplierId) {
        if (config.baseUrl === undefined)
          config.baseUrl = existing.config.baseUrl;
        if (
          normalizeSupplierSiteBase(String(config.baseUrl || "")) !==
          normalizeSupplierSiteBase(String(existing.config.baseUrl || ""))
        )
          return jsonError(
            "请从供应商连接地址修改 API 地址，以归档旧分组与 Key",
            409,
          );
      }
      if (existing.config.supplierSourceId)
        config.supplierSourceId = existing.config.supplierSourceId;
      if (existing.config.supplierId && config.supplierId === undefined)
        config.supplierId = existing.config.supplierId;
      if (existing.config.manualModels && config.manualModels === undefined)
        config.manualModels = existing.config.manualModels;
      if (
        existing.config.supplierId &&
        config.supplierId &&
        existing.config.supplierId !== config.supplierId
      )
        return jsonError(
          "不能把已保存 Key 的分组移到其他供应商，请新建独立连接",
          409,
        );
      const previousSupplier = supplierKeyForConnection(existing);
      const nextSupplier = supplierKeyForConnection({
        provider: parsed.data.provider,
        config,
      });
      if (previousSupplier !== nextSupplier)
        return jsonError("不能将已有连接切换到其他供应商，请新建独立连接", 409);
    }
    validateManualProviderModels(parsed.data.provider, config);
    Object.assign(
      config,
      await supplierConfigForConnection({
        provider: parsed.data.provider,
        config,
      }),
    );
    // A newly submitted key starts a fresh availability sequence. Do not let
    // an empty response recorded for the previous key confirm this key.
    if (parsed.data.apiKey) clearEmptyScanConfirmation(config);
    if (config.preset === CHENTU_PRESET_ID) {
      // Browser-submitted 辰途 inventories are never authoritative. The server
      // rebuilds these from the saved key's /v1/models scan plus the live
      // marketplace pricing, so a stale client connector can't stay callable.
      delete config.connector;
      delete config.allowedModels;
      delete config.scannedModelIds;
      delete config.modelScanStatus;
    }
    if (config.preset === "cyberafei-api") {
      const previousGroup =
        typeof existing?.config.modelGroup === "string"
          ? existing.config.modelGroup
          : "";
      const nextGroup =
        typeof config.modelGroup === "string" ? config.modelGroup : "";
      const capabilityScopeChanged =
        Boolean(parsed.data.apiKey) ||
        (Boolean(previousGroup) && previousGroup !== nextGroup);
      // Browser-submitted Cyber Afei inventories are never authoritative.
      // The server rebuilds these fields only from the saved key's /v1/models
      // scan, so a failed scan cannot leave a stale client connector callable.
      delete config.connector;
      delete config.allowedModels;
      delete config.scannedModelIds;
      delete config.modelScanStatus;
      if (capabilityScopeChanged) delete config.capabilityBlocks;
      else if (existing?.config.capabilityBlocks)
        config.capabilityBlocks = existing.config.capabilityBlocks;
    }
    if (config.customGroup === true) {
      const previousGroup =
        typeof existing?.config.modelGroup === "string"
          ? existing.config.modelGroup
          : "";
      const nextGroup =
        typeof config.modelGroup === "string" ? config.modelGroup : "";
      const previousBaseUrl =
        typeof existing?.config.baseUrl === "string"
          ? existing.config.baseUrl
          : "";
      const nextBaseUrl =
        typeof config.baseUrl === "string" ? config.baseUrl : "";
      const scopeChanged =
        Boolean(parsed.data.apiKey) ||
        previousGroup !== nextGroup ||
        previousBaseUrl !== nextBaseUrl;
      const scanFields = [
        "modelScanStatus",
        "modelScanCheckedAt",
        "scannedModelIds",
        "modelScanGroups",
        "modelCatalogModels",
        "modelCatalogSource",
      ] as const;
      for (const field of scanFields) {
        if (scopeChanged) delete config[field];
        else if (existing?.config[field] !== undefined)
          config[field] = existing.config[field];
        else delete config[field];
      }
    } else if (existing?.config.customGroup === true) {
      for (const field of [
        "modelScanStatus",
        "modelScanCheckedAt",
        "scannedModelIds",
        "modelScanGroups",
        "modelCatalogModels",
        "modelCatalogSource",
      ])
        delete config[field];
    }
    if (parsed.data.provider === "weai" || config.supplierKey === "weai") {
      const previousGroup =
        typeof existing?.config.modelGroup === "string"
          ? existing.config.modelGroup
          : "";
      const nextGroup =
        typeof config.modelGroup === "string" ? config.modelGroup : "";
      const previousBaseUrl =
        typeof existing?.config.baseUrl === "string"
          ? existing.config.baseUrl
          : "";
      const nextBaseUrl =
        typeof config.baseUrl === "string" ? config.baseUrl : "";
      const previousProtocol =
        typeof existing?.config.protocol === "string"
          ? existing.config.protocol
          : "";
      const nextProtocol =
        typeof config.protocol === "string" ? config.protocol : "";
      const capabilityScopeChanged =
        Boolean(parsed.data.apiKey) ||
        previousGroup !== nextGroup ||
        previousBaseUrl !== nextBaseUrl ||
        previousProtocol !== nextProtocol;
      const scanFields = [
        "modelScanStatus",
        "modelScanCheckedAt",
        "scannedModelIds",
      ] as const;
      for (const field of scanFields) {
        if (capabilityScopeChanged) delete config[field];
        else if (existing?.config[field] !== undefined)
          config[field] = existing.config[field];
        else delete config[field];
      }
      if (capabilityScopeChanged) delete config.unavailableModels;
      else if (existing?.config.unavailableModels !== undefined)
        config.unavailableModels = existing.config.unavailableModels;
    }
    // Never trust scan state submitted by the browser; scope it to the saved credentials.
    const identityFields = [
      "baseUrl",
      "modelGroup",
      "protocol",
      "directorProtocol",
      "usage",
      "supplierSourceId",
    ];
    const identityChanged =
      !!parsed.data.apiKey ||
      !existing ||
      identityFields.some((k) => config[k] !== existing.config[k]);
    for (const field of [
      "modelScanStatus",
      "modelScanCheckedAt",
      "scannedModelIds",
      "modelScanGroups",
      "modelCatalogModels",
      "modelCatalogSource",
      "weAiLivePricing",
      "modelProtocolTemplate",
      "unknownModels",
      "unavailableModels",
    ]) {
      if (identityChanged) delete config[field];
      else if (existing?.config[field] !== undefined)
        config[field] = existing.config[field];
      else delete config[field];
    }
    config.modelScanRequestId = randomUUID();
    if (identityChanged) config.modelScanStatus = "unscanned";
    const connection = await saveProviderConnection({
      expected: existing ?? undefined,
      id: parsed.data.id,
      name: parsed.data.name,
      provider: parsed.data.provider,
      apiKey: parsed.data.apiKey,
      config,
    });
    // Saving credentials is independent of scanning. Explicit test/refresh owns inventories.
    return Response.json(maskConnection(connection), {
      status: parsed.data.id ? 200 : 201,
    });
  } catch (error) {
    if (error instanceof SupplierConflictError)
      return jsonError(error.message, 409);
    if (error instanceof ManualModelValidationError)
      return jsonError(error.message, 400);
    if (error instanceof SupplierServiceError)
      return jsonError(error.message, error.status);
    return jsonError("供应商连接保存失败", 500);
  }
}
