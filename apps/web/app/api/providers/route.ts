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
import { syncCangyuanConnection } from "../../../lib/cangyuan-catalog";
import { syncCyberAfeiConnection } from "../../../lib/cyberafei-server";
import { CHENTU_PRESET_ID } from "../../../lib/chentu-presets";
import { syncChentuConnection } from "../../../lib/chentu-server";
import { FRIMODEL_PRESET_ID } from "../../../lib/frimodel-presets";
import { syncFriModelConnection } from "../../../lib/frimodel-server";
import { syncMikotoConnection } from "../../../lib/mikoto-server";
import { syncMiaowuConnection } from "../../../lib/miaowu-server";
import { clearEmptyScanConfirmation } from "../../../lib/model-scan-confirmation";
import { supplierKeyForConnection } from "../../../lib/supplier-identity";

export async function GET(_request?: Request) {
  void _request;
  // Listing saved connections must stay read-only. Provider-specific model
  // routes perform an explicit refresh when the user asks for one; a page
  // load must never rewrite a saved connector or its default model.
  const connections = await repository.listConnections();
  return Response.json(
    connections.map((connection) => maskConnection(connection)),
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
      const previousSupplier = supplierKeyForConnection(existing);
      const nextSupplier = supplierKeyForConnection({
        provider: parsed.data.provider,
        config,
      });
      if (previousSupplier !== nextSupplier)
        return jsonError(
          "不能将已有连接切换到其他供应商，请新建独立连接",
          409,
        );
    }
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
    let connection = await saveProviderConnection({
      id: parsed.data.id,
      name: parsed.data.name,
      provider: parsed.data.provider,
      apiKey: parsed.data.apiKey,
      config,
    });
    if (connection.config.preset === "cangyuan-gpt-image-2") {
      connection = (await syncCangyuanConnection(connection.id)) ?? connection;
    }
    if (connection.config.preset === "cyberafei-api") {
      connection = (await syncCyberAfeiConnection(connection.id)) ?? connection;
    }
    if (connection.config.preset === "mikoto-pro") {
      connection = (await syncMikotoConnection(connection.id)) ?? connection;
    }
    if (connection.config.preset === "miaowu-openai-videos") {
      connection = (await syncMiaowuConnection(connection.id)) ?? connection;
    }
    if (connection.config.preset === CHENTU_PRESET_ID) {
      connection = (await syncChentuConnection(connection.id)) ?? connection;
    }
    if (connection.config.preset === FRIMODEL_PRESET_ID) {
      connection = (await syncFriModelConnection(connection.id)) ?? connection;
    }
    return Response.json(maskConnection(connection), {
      status: parsed.data.id ? 200 : 201,
    });
  } catch {
    return jsonError("供应商连接保存失败", 500);
  }
}
