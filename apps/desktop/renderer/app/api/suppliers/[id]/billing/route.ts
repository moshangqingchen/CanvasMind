import { SupplierConflictError } from "@super-canvas/db";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError } from "../../../../../lib/server";
import { getSupplierRecord, SupplierServiceError } from "../../../../../lib/supplier-service";
import { refreshSupplierBilling } from "../../../../../lib/supplier-billing";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  const supplier = await getSupplierRecord(id.data);
  if (!supplier || supplier.state?.visibility === "deleted") return jsonError("供应商不存在", 404);
  return Response.json(supplier.state?.billing?.sourceId === supplier.state?.sourceId ? supplier.state?.billing ?? null : null,
    { headers: { "Cache-Control": "no-store" } });
}
/** Refreshing account totals never schedules generation or changes verification queues. */
export async function POST(_request: Request, context: Context) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  try { return Response.json(await refreshSupplierBilling(id.data)); }
  catch (error) { return jsonError(error instanceof SupplierConflictError ? "供应商配置已变化，请重试" : "账务读取失败",
    error instanceof SupplierConflictError ? 409 : error instanceof SupplierServiceError ? error.status : 500); }
}
