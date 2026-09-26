import { z } from "zod";
import { parseJsonRequest } from "../../../../../lib/api-validation";
import { jsonError } from "../../../../../lib/server";
import {
  getSupplierRecord,
  restoreSupplierHistory,
  publicSupplierRecord,
} from "../../../../../lib/supplier-service";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supplier = await getSupplierRecord((await context.params).id);
  if (!supplier || supplier.state?.visibility === "deleted")
    return jsonError("供应商不存在", 404);
  return Response.json(
    {
      revision: supplier.state?.revision ?? 0,
      history: supplier.state?.history ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonRequest(
    request,
    z
      .object({
        sourceId: z.string().min(1).max(256),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict(),
  );
  if (!parsed.success) return parsed.response;
  try {
    return Response.json(
      publicSupplierRecord(
        await restoreSupplierHistory(
          (await context.params).id,
          parsed.data.sourceId,
          parsed.data.expectedRevision,
        ),
      ),
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "恢复失败", 409);
  }
}
