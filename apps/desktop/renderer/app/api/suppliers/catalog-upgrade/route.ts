import { SupplierCatalogUpgrade } from "../../../../lib/supplier-catalog-upgrade";
import { trackDesktopBackgroundWrite } from "../../../../lib/desktop-server";
import { readProviderModelInventory } from "../../../../lib/provider-model-inventory";
import { repository } from "../../../../lib/server";
import { scanSupplierRecord } from "../../../../lib/supplier-service";
import { outsideCatalogRepository, withCatalogRepository } from "../../../../lib/catalog-repository-scope";
import { CATALOG_MODE_SETTING } from "../../../../lib/supplier-catalog-policy";
import { isDeepStrictEqual } from "node:util";
import type { SupplierRecord } from "@super-canvas/db";

export const dynamic = "force-dynamic";
const scope = globalThis as typeof globalThis & { __supplierCatalogUpgrade?: SupplierCatalogUpgrade };
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
export async function POST(): Promise<Response> {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return new Response(null, { status: 404 });
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
  return Response.json(await service().status(), { headers: { "Cache-Control": "no-store" } });
}
