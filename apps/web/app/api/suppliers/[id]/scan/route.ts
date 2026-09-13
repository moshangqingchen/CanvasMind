import { SupplierConflictError } from "@super-canvas/db";
import {
  parseJsonRequest,
  parseRouteIdentifier,
} from "../../../../../lib/api-validation";
import { jsonError } from "../../../../../lib/server";
import {
  scanSupplierRecord,
  publicSupplierRecord,
  SupplierScanSchema,
  SupplierServiceError,
} from "../../../../../lib/supplier-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  const parsed = await parseJsonRequest(
    request,
    SupplierScanSchema.required({ expectedRevision: true }),
  );
  if (!parsed.success) return parsed.response;
  try {
    return Response.json(
      publicSupplierRecord(
        await scanSupplierRecord(
          id.data,
          parsed.data.token,
          parsed.data.expectedRevision,
        ),
      ),
    );
  } catch (error) {
    if (error instanceof SupplierConflictError)
      return jsonError(error.message, 409);
    return jsonError(
      error instanceof SupplierServiceError
        ? error.message
        : "供应商扫描失败，请重试或手动添加分组",
      error instanceof SupplierServiceError ? error.status : 500,
    );
  }
}
