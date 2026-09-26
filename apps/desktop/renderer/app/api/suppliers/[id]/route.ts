import { SupplierConflictError } from "@super-canvas/db";
import {
  parseJsonRequest,
  parseRouteIdentifier,
} from "../../../../lib/api-validation";
import { jsonError } from "../../../../lib/server";
import {
  deleteSupplierRecord,
  supplierImpact,
  patchSupplierRecord,
  publicSupplierRecord,
  SupplierPatchSchema,
  SupplierServiceError,
} from "../../../../lib/supplier-service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  const parsed = await parseJsonRequest(
    request,
    SupplierPatchSchema.required({ expectedRevision: true }),
  );
  if (!parsed.success) return parsed.response;
  try {
    return Response.json(
      publicSupplierRecord(await patchSupplierRecord(id.data, parsed.data)),
    );
  } catch (error) {
    if (error instanceof SupplierConflictError)
      return jsonError(error.message, 409);
    return jsonError(
      error instanceof SupplierServiceError ? error.message : "供应商更新失败",
      error instanceof SupplierServiceError ? error.status : 500,
    );
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(await supplierImpact((await context.params).id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "读取失败", 409);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonRequest(
    request,
    SupplierPatchSchema.required({ expectedRevision: true }),
  );
  if (!parsed.success) return parsed.response;
  try {
    return Response.json(
      publicSupplierRecord(
        await deleteSupplierRecord(
          (await context.params).id,
          parsed.data.expectedRevision,
        ),
      ),
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "删除失败", 409);
  }
}
