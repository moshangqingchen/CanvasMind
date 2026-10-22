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
import { reconcileConnectionInventory } from "../../../lib/connection-inventory-state";
import { supplierKeyForConnection } from "../../../lib/supplier-identity";
import { shouldAutomaticallyVerifyConnection } from "../../../lib/supplier-verification-service";
import {
  listSupplierRecords,
  supplierOwnsStoredConnection,
  assertCurrentSupplierConnection,
  prepareSupplierConnection,
  SupplierServiceError,
} from "../../../lib/supplier-service";
import {
  validateManualProviderModels,
  ManualModelValidationError,
} from "../../../lib/manual-provider-models";

export async function GET(_request?: Request) {
  void _request;
  // Project current names without migrating accounts or fetching model catalogs.
  const supplierRecords = await listSupplierRecords();
  const suppliers = new Map(supplierRecords.map((supplier) => [supplier.id, supplier]));
  const connections = await repository.listConnections();
  return Response.json(
    connections
      .filter((c) => c.config.supplierArchived !== true)
      .map((connection) => {
        if (["fake", "cli"].includes(connection.provider)) return maskConnection(connection);
        const supplier = connection.config.supplierId
          ? suppliers.get(String(connection.config.supplierId))
          : supplierRecords.find((record) => supplierOwnsStoredConnection(record, connection));
        return maskConnection(
          supplier && supplier.supplierKey === supplierKeyForConnection(connection)
            ? { ...connection, config: { ...connection.config, supplierId: supplier.id, supplierName: supplier.name } }
            : connection,
        );
      }),
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    ProviderConnectionRequestSchema,
  );
  if (!parsed.success) return parsed.response;

  if (parsed.data.provider === "cli") {
    const { saveCliConnection } = await import("../../../lib/cli-connections-server");
    return saveCliConnection(parsed.data);
  }

  try {
    let config = { ...(parsed.data.config ?? {}) };
    let existing = parsed.data.id
      ? await repository.getConnection(parsed.data.id)
      : null;
    if (parsed.data.id && !existing)
      return jsonError("供应商连接不存在，不能使用旧连接 ID 创建新供应商", 404);
    if (existing?.provider === "cli")
      return jsonError("不能更改个人网站连接的接入类型，请新建连接", 409);
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
    const binding = await prepareSupplierConnection({
      provider: parsed.data.provider, config, existingConnection: existing ?? undefined,
    });
    Object.assign(config, binding.config);
    existing = binding.existingConnection ?? existing;
    // A newly submitted key starts a fresh availability sequence. Do not let
    // an empty response recorded for the previous key confirm this key.
    if (parsed.data.apiKey) {
      delete config.accountKeyId;
      delete config.accountKeyGroup;
      delete config.accountKeyImportedAt;
    }
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
    const inventory = reconcileConnectionInventory(config, existing, parsed.data.provider, Boolean(parsed.data.apiKey));
    config = inventory.config;
    const { identityChanged } = inventory;
    if (!identityChanged && existing?.provider === parsed.data.provider && existing.config.preset === config.preset
      && [CHENTU_PRESET_ID, "cyberafei-api"].includes(String(config.preset))) {
      // Preserve the server's protocol on an ordinary settings save. Its
      // browser copy is untrusted, but deleting it would invalidate paid evidence.
      if (existing.config.connector) config.connector = existing.config.connector;
      else delete config.connector;
    }
    config.modelScanRequestId = randomUUID();
    if (identityChanged) config.modelScanStatus = "unscanned";
    const verificationRequested = shouldAutomaticallyVerifyConnection(existing, {
      id: parsed.data.id ?? "", name: parsed.data.name, provider: parsed.data.provider,
      createdAt: existing?.createdAt ?? "", updatedAt: existing?.updatedAt ?? "",
      encryptedSecret: parsed.data.apiKey ? "changed-credentials" : existing?.encryptedSecret,
      config,
    });
    // Keep onboarding durable if the app closes before the free scan finishes.
    // A browser cannot create, clear or replay this server-owned request marker.
    if (verificationRequested) config.supplierVerificationRequestId = randomUUID();
    else if (existing?.config.supplierVerificationRequestId) config.supplierVerificationRequestId = existing.config.supplierVerificationRequestId;
    else delete config.supplierVerificationRequestId;
    const connection = await saveProviderConnection({
      expected: existing ?? undefined,
      id: parsed.data.id,
      name: parsed.data.name,
      provider: parsed.data.provider,
      apiKey: parsed.data.apiKey,
      config,
    });
    // A new/changed supplier Key owns onboarding, including free agent discovery. Reading models or saving
    // unrelated defaults never starts paid verification.
    const verificationScheduled = verificationRequested;
    if (verificationScheduled) {
      const { scheduleSupplierVerification } = await import("../../../lib/supplier-verification");
      void scheduleSupplierVerification(String(connection.config.supplierId))
        .catch(() => console.error("[supplier-verification] 自动核验计划未完成，请查看核验记录"));
    }
    return Response.json({ ...maskConnection(connection), verificationScheduled }, {
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
