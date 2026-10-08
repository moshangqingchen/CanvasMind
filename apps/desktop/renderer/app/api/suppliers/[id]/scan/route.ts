import { SupplierConflictError } from "@super-canvas/db";
import {
  parseJsonRequest,
  parseRouteIdentifier,
} from "../../../../../lib/api-validation";
import { jsonError, repository } from "../../../../../lib/server";
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
    const supplier = await scanSupplierRecord(id.data, parsed.data.token, parsed.data.expectedRevision,
      { verifyCapabilities: parsed.data.verifyCapabilities, catalogOnly: parsed.data.catalogOnly });
    if (!parsed.data.catalogOnly && parsed.data.verifyCapabilities !== false) {
      const pendingKeys = (await repository.listConnections()).some(connection => connection.config.supplierId === supplier.id
        && connection.config.supplierVerificationRequestId && connection.config.supplierArchived !== true);
      if (supplier.scanStatus === "live" || pendingKeys) {
        const { scheduleSupplierVerification } = await import("../../../../../lib/supplier-verification");
        void scheduleSupplierVerification(supplier.id).catch(() => console.error("[supplier-verification] 未能创建核验计划"));
      }
    }
    return Response.json(publicSupplierRecord(supplier));
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
