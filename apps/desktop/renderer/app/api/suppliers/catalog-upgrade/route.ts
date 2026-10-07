import { SupplierCatalogUpgrade } from "../../../../lib/supplier-catalog-upgrade";
import { trackDesktopBackgroundWrite } from "../../../../lib/desktop-server";
import { readProviderModelInventory } from "../../../../lib/provider-model-inventory";
import { repository } from "../../../../lib/server";

export const dynamic = "force-dynamic";
const scope = globalThis as typeof globalThis & { __supplierCatalogUpgrade?: SupplierCatalogUpgrade };
function service() {
  return scope.__supplierCatalogUpgrade ??= new SupplierCatalogUpgrade({ repository,
    readModels: readProviderModelInventory, trackWrite: trackDesktopBackgroundWrite,
    canContinue: () => globalThis.__superCanvasDesktopLifecycle?.draining !== true });
}
// The desktop session proxy authorizes browser requests before this route.
export async function POST(): Promise<Response> {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return new Response(null, { status: 404 });
  service().start();
  return Response.json(service().status(), { status: 202, headers: { "Cache-Control": "no-store" } });
}
export async function GET(): Promise<Response> {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return new Response(null, { status: 404 });
  return Response.json(service().status(), { headers: { "Cache-Control": "no-store" } });
}
