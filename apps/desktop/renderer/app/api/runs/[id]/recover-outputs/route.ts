import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError, publicRunSnapshot, runService } from "../../../../../lib/server";

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsedId = parseRouteIdentifier(id, "运行 ID");
  if (!parsedId.success) return parsedId.response;
  try {
    const run = await runService.recoverRunOutputs(parsedId.data);
    if (!run) return jsonError("运行不存在", 404);
    return Response.json(publicRunSnapshot(await runService.getRun(run.id)));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "取回已有图片失败", 409);
  }
}
