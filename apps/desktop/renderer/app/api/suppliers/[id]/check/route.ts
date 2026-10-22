import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError, repository } from "../../../../../lib/server";
import { createSupplierReadOnlyReaders } from "../../../../../lib/supplier-readonly-check-readers";
import { checkSupplierReadOnly, SupplierReadOnlyCheckError } from "../../../../../lib/supplier-readonly-check";
import { getSupplierRecord } from "../../../../../lib/supplier-service";

export const dynamic = "force-dynamic";

/** Authentication is request-local; no scan, publisher, scheduler or persistent cache is used. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  try {
    const report = await checkSupplierReadOnly(id.data, { repository: {
      getSupplier: getSupplierRecord, listConnections: () => repository.listConnections(),
    },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
      readers: createSupplierReadOnlyReaders() });
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof SupplierReadOnlyCheckError ? error.message : "只读检测未完成，请检查供应商地址与连接后重试",
      error instanceof SupplierReadOnlyCheckError ? error.status : 500);
  }
}
