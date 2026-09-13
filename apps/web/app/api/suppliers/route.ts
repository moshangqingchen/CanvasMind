import { parseJsonRequest } from "../../../lib/api-validation";
import { jsonError } from "../../../lib/server";
import {
  createSupplierRecord,
  listSupplierRecords,
  publicSupplierRecord,
  SupplierInputSchema,
  SupplierServiceError,
} from "../../../lib/supplier-service";

export async function GET() {
  return Response.json(
    (await listSupplierRecords()).map(publicSupplierRecord),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, SupplierInputSchema);
  if (!parsed.success) return parsed.response;
  try {
    return Response.json(
      publicSupplierRecord(await createSupplierRecord(parsed.data)),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(
      error instanceof SupplierServiceError ? error.message : "供应商保存失败",
      error instanceof SupplierServiceError ? error.status : 500,
    );
  }
}
