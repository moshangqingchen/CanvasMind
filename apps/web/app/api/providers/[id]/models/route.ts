import { getRunService, type RunService } from "@super-canvas/runtime";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { repository, jsonError } from "../../../../../lib/server";
import { syncCangyuanConnection } from "../../../../../lib/cangyuan-catalog";

function adapterFor(service: RunService, provider: string) {
  const anyService = service as unknown as {
    adapters?: () => Map<string, unknown>;
  };
  return anyService.adapters?.()?.get(provider);
}

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  let connection = await repository.getConnection(id);
  if (!connection) return jsonError("供应商连接不存在", 404);
  connection = (await syncCangyuanConnection(id)) ?? connection;
  const adapter = adapterFor(getRunService(), connection.provider);
  if (!adapter || typeof adapter !== "object" || !("listModels" in adapter))
    return jsonError("供应商适配器不可用", 422);
  try {
    return Response.json(
      await (
        adapter as { listModels: (id: string) => Promise<unknown> }
      ).listModels(id),
    );
  } catch {
    return jsonError("模型列表读取失败，请检查供应商连接", 502);
  }
}
