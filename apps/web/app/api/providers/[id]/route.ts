import { parseRouteIdentifier } from "../../../../lib/api-validation";
import { repository, jsonError, maskConnection } from "../../../../lib/server";

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
