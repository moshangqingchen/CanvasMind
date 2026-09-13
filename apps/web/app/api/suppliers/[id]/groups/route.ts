import { z } from "zod";
import { SupplierConflictError } from "@super-canvas/db";
import {
  parseJsonRequest,
  parseRouteIdentifier,
} from "../../../../../lib/api-validation";
import { jsonError } from "../../../../../lib/server";
import {
  deleteManualSupplierGroup,
  publicSupplierRecord,
  SupplierServiceError,
} from "../../../../../lib/supplier-service";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const id = parseRouteIdentifier((await context.params).id, "供应商 ID");
  if (!id.success) return id.response;
  const parsed = await parseJsonRequest(
    request,
    z
      .object({
        groupId: z.string().trim().min(1).max(256),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict(),
  );
  if (!parsed.success) return parsed.response;
  try {
    return Response.json(
      publicSupplierRecord(
        await deleteManualSupplierGroup(
          id.data,
          parsed.data.groupId,
          parsed.data.expectedRevision,
        ),
      ),
    );
  } catch (error) {
    return jsonError(
      error instanceof SupplierConflictError ||
        error instanceof SupplierServiceError
        ? error.message
        : "删除分组失败",
      error instanceof SupplierConflictError
        ? 409
        : error instanceof SupplierServiceError
          ? error.status
          : 500,
    );
  }
}
