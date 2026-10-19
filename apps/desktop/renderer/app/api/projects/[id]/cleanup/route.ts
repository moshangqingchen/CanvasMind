import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError, repository } from "../../../../../lib/server";
import { ensureProjectDirectory } from "../../../../../lib/project-service";
import { getProjectFileStore } from "@super-canvas/storage";
import { projectCoordinator, ProjectMutationError } from "../../../../../lib/project-coordinator";

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "项目 ID");
  if (!parsedId.success) return parsedId.response;
  return projectCoordinator(repository).withCanvas(parsedId.data, async () => {
  const canvas = await repository.getCanvas(parsedId.data);
  if (!canvas) return jsonError("项目不存在", 404);
  try {
    const result = await getProjectFileStore().clearDraft(canvas.title);
    await ensureProjectDirectory(canvas);
    return Response.json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "项目草稿清理失败", 500);
  }
  }).catch(error => jsonError(error instanceof Error ? error.message : "项目草稿清理失败", error instanceof ProjectMutationError ? error.status : 500));
}
