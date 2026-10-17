import { SupplierCatalogUpgrade, SUPPLIER_CATALOG_REVISION } from "../../../../lib/supplier-catalog-upgrade";
import { trackDesktopBackgroundWrite } from "../../../../lib/desktop-server";
import { readProviderModelInventory } from "../../../../lib/provider-model-inventory";
import { repository } from "../../../../lib/server";
import { scanSupplierRecord } from "../../../../lib/supplier-service";
import { outsideCatalogRepository, withCatalogRepository } from "../../../../lib/catalog-repository-scope";
import { CATALOG_MODE_SETTING } from "../../../../lib/supplier-catalog-policy";
import { isDeepStrictEqual } from "node:util";
import type { SupplierRecord } from "@super-canvas/db";
import { decryptSecret, providerFetch } from "@super-canvas/providers";
import { requireServerMasterKey } from "../../../../lib/master-key";
import { previewCatalogUpgradeReads } from "../../../../lib/catalog-upgrade-preview";
import { catalogReadPreviewEnabled } from "../../../../lib/catalog-source-plan";
import { createCatalogPipelineService } from "../../../../lib/catalog-pipeline-service";
import { createCatalogPipelineWakeLoop } from "../../../../lib/catalog-pipeline-wake";

export const dynamic = "force-dynamic";
const scope = globalThis as typeof globalThis & { __supplierCatalogUpgrade?: SupplierCatalogUpgrade;
  __supplierCatalogReadPipeline?: ReturnType<typeof createCatalogPipelineService>;
  __supplierCatalogReadWake?: ReturnType<typeof createCatalogPipelineWakeLoop>;
  __supplierCatalogReadStop?: () => void };
function stopReadPipeline() {
  scope.__supplierCatalogReadWake?.close(); scope.__supplierCatalogReadPipeline?.close();
  delete scope.__supplierCatalogReadWake; delete scope.__supplierCatalogReadPipeline; delete scope.__supplierCatalogReadStop;
}
function readPipeline() {
  return scope.__supplierCatalogReadPipeline ??= createCatalogPipelineService({ repository, environment: process.env,
    canContinue: () => globalThis.__superCanvasDesktopLifecycle?.draining !== true,
    trackWrite: async work => { let value!: Awaited<ReturnType<typeof work>>;
      await trackDesktopBackgroundWrite(async () => { value = await work(); }); return value; },
    readers: async connection => {
      let apiKey = "";
      try { if (connection.encryptedSecret) apiKey = decryptSecret(connection.encryptedSecret, requireServerMasterKey()); } catch { /* Remains unread. */ }
      return { apiKey, fetchFor: spec => spec.authScope.kind === "site-account" || spec.authScope.kind === "connection-key" && !apiKey ? undefined : providerFetch };
    } });
}
function service() {
  // Shared only within one scheduled cycle; a foreground supplier edit invalidates
  // the cache. Each Key inventory is still checked independently once per cycle.
  let batchId: string | undefined;
  const catalogs = new Map<string, { before: SupplierRecord; after: SupplierRecord }>();
  return scope.__supplierCatalogUpgrade ??= new SupplierCatalogUpgrade({ repository,
    trackWrite: trackDesktopBackgroundWrite,
    refreshCatalog: (connection, supplier, staging, refreshId) => withCatalogRepository(staging, async () => {
      const enabled = () => outsideCatalogRepository(async () => await repository.getApplicationSetting(CATALOG_MODE_SETTING) !== "off");
      if (!await enabled()) return { complete: false, code: "cancelled" };
      if (batchId !== refreshId) { catalogs.clear(); batchId = refreshId; }
      if (supplier) {
        const cached = catalogs.get(supplier.id);
        const sameSnapshot = cached && isDeepStrictEqual([
          supplier.siteUrl, supplier.apiUrl, supplier.kind, supplier.state?.sourceId, supplier.state?.siteLogin,
          supplier.catalog, supplier.scanLastSuccessAt,
        ], [cached.after.siteUrl, cached.after.apiUrl, cached.after.kind, cached.after.state?.sourceId, cached.after.state?.siteLogin,
          cached.after.catalog, cached.after.scanLastSuccessAt]);
        const refreshed = cached && (isDeepStrictEqual(supplier, cached.before) || sameSnapshot)
          ? await staging.saveSupplier(cached.after)
          : await scanSupplierRecord(supplier.id, undefined, supplier.state?.revision, { catalogOnly: true, verifyCapabilities: false });
        catalogs.set(supplier.id, { before: supplier, after: refreshed });
        if (refreshed.state?.sourceId !== supplier.state?.sourceId || refreshed.scanComplete !== true ||
          !["live", "empty"].includes(refreshed.scanStatus))
          return { complete: false, code: refreshed.scanErrorCode ?? "incomplete" };
      }
      if (!await enabled()) return { complete: false, code: "cancelled" };
      const response = await readProviderModelInventory(new Request(
        `http://localhost/api/providers/${encodeURIComponent(connection.id)}/models?refresh=1`),
        { params: Promise.resolve({ id: connection.id }), supplierRefreshId: refreshId, clearCatalogMarker: false });
      return { complete: response.ok && response.headers.get("X-Model-Scan-Complete") === "true" &&
        ["live", "empty"].includes(response.headers.get("X-Model-Scan-Status") ?? ""), status: response.status,
        code: response.headers.get("X-Model-Scan-Error-Code") ?? undefined };
    }),
    canContinue: () => globalThis.__superCanvasDesktopLifecycle?.draining !== true });
}
// The desktop session proxy authorizes browser requests before this route.
export async function POST(request?: Request): Promise<Response> {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return new Response(null, { status: 404 });
  if (request && new URL(request.url).searchParams.has("readPipeline")) {
    if (!catalogReadPreviewEnabled(process.env)) return new Response(null, { status: 404 });
    const body = await request.json().catch(() => null) as { connectionId?: unknown } | null;
    if (typeof body?.connectionId !== "string" || body.connectionId.length > 256) return Response.json({ error: "请选择连接" }, { status: 400 });
    const pipeline = readPipeline();
    scope.__supplierCatalogReadStop = stopReadPipeline;
    const result = await pipeline.run(body.connectionId, { observationCycleId: `daily:${new Date().toISOString().slice(0, 10)}`,
      revision: SUPPLIER_CATALOG_REVISION });
    if (globalThis.__superCanvasDesktopLifecycle?.draining === true) return Response.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
    const wake = scope.__supplierCatalogReadWake ??= createCatalogPipelineWakeLoop({
      clock: { now: Date.now, setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
        clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) },
      connectionIds: async () => (await repository.listConnections()).filter(row => row.config.supplierArchived !== true).map(row => row.id),
      run: (connectionId, observationCycleId) => pipeline.run(connectionId, { observationCycleId, revision: SUPPLIER_CATALOG_REVISION }),
      canContinue: () => globalThis.__superCanvasDesktopLifecycle?.draining !== true, close: () => pipeline.close(),
    });
    void wake.wake().catch(() => undefined);
    return Response.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  if (request && new URL(request.url).searchParams.has("readPreview")) {
    const body = await request.json().catch(() => null) as { connectionId?: unknown } | null;
    if (typeof body?.connectionId !== "string" || body.connectionId.length > 256)
      return Response.json({ error: "请选择连接" }, { status: 400 });
    return previewCatalogUpgradeReads(body.connectionId, { environment: process.env, repository,
      readers: async connection => {
        let apiKey = "";
        try { if (connection.encryptedSecret) apiKey = decryptSecret(connection.encryptedSecret, requireServerMasterKey()); }
        catch { /* Public sources are still independent; missing credentials are not an empty Key list. */ }
        return { apiKey, fetchFor: spec => spec.authScope.kind === "site-account" ? undefined
          : spec.authScope.kind === "connection-key" && !apiKey ? undefined : providerFetch };
      } });
  }
  service().start();
  return Response.json(await service().status(true), { status: 202, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request): Promise<Response> {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return new Response(null, { status: 404 });
  return Response.json(await service().status(new URL(request.url).searchParams.get("summary") === "1"), { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: Request): Promise<Response> {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return new Response(null, { status: 404 });
  const body = await request.json().catch(() => null) as { mode?: unknown } | null;
  if (!body || !["off", "upgrade", "daily"].includes(String(body.mode)))
    return Response.json({ error: "请选择关闭、仅软件升级后或每天一次" }, { status: 400 });
  await service().setMode(body.mode as "off" | "upgrade" | "daily");
  if (body.mode === "off") stopReadPipeline();
  return Response.json(await service().status(), { headers: { "Cache-Control": "no-store" } });
}
