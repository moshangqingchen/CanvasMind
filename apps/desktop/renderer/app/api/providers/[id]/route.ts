import { z } from "zod";
import { SupplierConflictError } from "@super-canvas/db";
import { parseJsonRequest, parseRouteIdentifier, MAX_SMALL_JSON_BODY_BYTES } from "../../../../lib/api-validation";
import { repository, jsonError, maskConnection } from "../../../../lib/server";
import { assertCurrentSupplierConnection, SupplierServiceError } from "../../../../lib/supplier-service";

const ReferenceHostingSettingsSchema = z.object({
  referenceImageHosting: z.enum(["disabled", "litterbox-24h"]),
}).strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedId = parseRouteIdentifier((await context.params).id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const parsed = await parseJsonRequest(request, ReferenceHostingSettingsSchema, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  try {
    const connection = await repository.getConnection(parsedId.data);
    if (!connection) return jsonError("供应商连接不存在", 404);
    await assertCurrentSupplierConnection(connection);
    if (connection.provider !== "rest" || connection.config.usage === "agent")
      return jsonError("此连接不支持参考图临时链接设置", 400);
    // Keep large server-owned catalogs and credentials out of a settings request.
    const saved = await repository.saveConnection({
      ...connection,
      config: { ...connection.config, ...parsed.data },
    }, { expected: connection });
    return Response.json(maskConnection(saved));
  } catch (error) {
    if (error instanceof SupplierConflictError) return jsonError(error.message, 409);
    if (error instanceof SupplierServiceError) return jsonError(error.message, error.status);
    return jsonError("参考图链接设置保存失败", 500);
  }
}

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  const connection = await repository.getConnection(id);
  return connection
    ? Response.json(maskConnection(connection))
    : jsonError("供应商连接不存在", 404);
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  await repository.deleteConnection(parsedId.data);
  return Response.json({ ok: true });
}
