import { randomUUID } from "node:crypto";
import type { ProviderConnectionRecord, Repository, SupplierRecord } from "@super-canvas/db";
import { collectCatalogReadCycle, type CatalogCollectorDependencies } from "./catalog-read-collector";
import { catalogConnectionScopes, catalogReadPreviewEnabled } from "./catalog-source-plan";
import { CATALOG_MODE_SETTING } from "./supplier-catalog-policy";

type PreviewRepository = Pick<Repository, "getConnection" | "getSupplier" | "getApplicationSetting">;
export interface CatalogReadPreviewDependencies {
  environment: Record<string, string | undefined>;
  repository: PreviewRepository;
  /** Resolve credentials only after the isolated-profile and mode guards. */
  readers(connection: ProviderConnectionRecord, supplier?: SupplierRecord): Promise<Pick<CatalogCollectorDependencies, "apiKey" | "fetchFor">>;
}

/** Explicit internal POST only. No staging repository or aggregate supplier scan
 * can gate the independent Key read. This slice cannot publish observations. */
export async function previewCatalogUpgradeReads(connectionId: string, dependencies: CatalogReadPreviewDependencies): Promise<Response> {
  if (!catalogReadPreviewEnabled(dependencies.environment)) return new Response(null, { status: 404 });
  if (await dependencies.repository.getApplicationSetting(CATALOG_MODE_SETTING) === "off")
    return Response.json({ previewOnly: true, publication: "disabled", mode: "off", observations: [] });
  const connection = await dependencies.repository.getConnection(connectionId);
  if (!connection) return Response.json({ error: "连接不存在" }, { status: 404 });
  const supplierId = connection.config.supplierId;
  const supplier = typeof supplierId === "string" ? await dependencies.repository.getSupplier(supplierId) ?? undefined : undefined;
  if (typeof supplierId === "string" && (!supplier || supplier.state?.visibility === "deleted") ||
    connection.config.supplierArchived === true || supplier?.state && connection.config.supplierSourceId !== supplier.state.sourceId)
    return Response.json({ error: "连接来源已经变化" }, { status: 409 });
  const readers = await dependencies.readers(connection, supplier);
  const result = await collectCatalogReadCycle(connection, supplier, { ...readers, enabled: true, context: {
    runId: randomUUID(), observationCycleId: randomUUID(), identityEpoch: catalogConnectionScopes(connection, supplier).key.credentialEpoch,
    // A preview has no durable dispatch reservation and is never accepted by the publisher.
    dispatchSeq: 0,
  } });
  return Response.json({ previewOnly: true, publication: result.publication, manifest: result.manifest,
    keyVisibleModelIds: result.keyVisibleModels.map(model => model.id), catalogOfferIds: result.catalogOffers.map(model => model.id),
    observations: result.observations.map(({ receipt, facts }) => ({ receipt, modelCount: facts.models.length,
      contractCount: facts.contracts?.length ?? 0 })) }, { headers: { "Cache-Control": "no-store" } });
}
