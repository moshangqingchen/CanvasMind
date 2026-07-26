import { parseRouteIdentifier } from "../../../../lib/api-validation";
import {
  jsonError,
  publicRunSnapshot,
  runService,
} from "../../../../lib/server";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "运行 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  const snapshot = await runService.getRun(id);
  return snapshot
    ? Response.json(publicRunSnapshot(snapshot))
    : jsonError("运行不存在", 404);
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "运行 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  try {
    const snapshot = await runService.cancelRun(id);
    return snapshot
      ? Response.json(publicRunSnapshot(await runService.getRun(id)))
      : jsonError("运行不存在", 404);
  } catch {
    return jsonError("运行已结束，无法取消", 409);
  }
}

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "运行 ID");
  if (!parsedId.success) return parsedId.response;
  try {
    const run = await runService.retryRun(parsedId.data);
    if (!run) return jsonError("运行不存在", 404);
    return Response.json(publicRunSnapshot(await runService.getRun(run.id)));
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "运行恢复失败",
      409,
    );
  }
}
