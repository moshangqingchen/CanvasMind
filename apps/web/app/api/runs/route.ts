import {
  CreateRunRequestSchema,
  RunsQuerySchema,
  parseJsonRequest,
  searchParamsToObject,
  validationError,
} from "../../../lib/api-validation";
import { jsonError, publicRunSnapshot, runService } from "../../../lib/server";
import { syncAllCangyuanConnections } from "../../../lib/cangyuan-catalog";

export async function GET(request: Request) {
  const query = RunsQuerySchema.safeParse(
    searchParamsToObject(new URL(request.url).searchParams),
  );
  if (!query.success) return validationError(query.error, "查询参数无效");

  const runs = await runService.repository.listRuns(query.data.canvasId);
  const snapshots = await Promise.all(
    runs.map(async (run) =>
      publicRunSnapshot({
        run,
        nodes: await runService.repository.listNodeRuns(run.id),
      }),
    ),
  );
  return Response.json(snapshots.filter((snapshot) => snapshot !== null));
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, CreateRunRequestSchema);
  if (!parsed.success) return parsed.response;

  try {
    await syncAllCangyuanConnections();
    const run = await runService.createRun(parsed.data);
    return Response.json(publicRunSnapshot(await runService.getRun(run.id)), {
      status: 201,
    });
  } catch {
    return jsonError("无法创建运行，请检查画布、节点和输入配置", 422);
  }
}
