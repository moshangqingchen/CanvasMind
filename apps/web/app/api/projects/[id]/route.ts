import { parseRouteIdentifier } from "../../../../lib/api-validation";
import { jsonError, repository } from "../../../../lib/server";
import { getProjectFileStore } from "@super-canvas/storage";
import { normalizedProjectTitle } from "../../../../lib/project-service";

const activeRunStatuses = new Set(["queued", "running"]);

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "项目 ID");
  if (!parsedId.success) return parsedId.response;

  const canvas = await repository.getCanvas(parsedId.data);
  if (!canvas) return jsonError("项目不存在", 404);
  const canvases = await repository.listCanvases();
  if (canvases.length <= 1)
    return jsonError("至少需要保留一个项目，最后一个项目不能删除", 409);
  const runs = await repository.listRuns(canvas.id);
  if (runs.some((run) => activeRunStatuses.has(run.status)))
    return jsonError("当前项目仍有生成任务运行，请等待任务结束后再删除", 409);
  const normalizedTitle = normalizedProjectTitle(canvas.title)
    .normalize("NFC")
    .toLocaleLowerCase();
  const folderSharedByLegacyProject = canvases.some(
    (other) =>
      other.id !== canvas.id &&
      normalizedProjectTitle(other.title)
        .normalize("NFC")
        .toLocaleLowerCase() === normalizedTitle,
  );

  try {
    await repository.deleteCanvas(canvas.id);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "项目删除失败", 500);
  }

  let folderDeleted = false;
  let warning: string | undefined;
  if (!folderSharedByLegacyProject) {
    try {
      folderDeleted = await getProjectFileStore().deleteProject(canvas.title);
    } catch (error) {
      warning = `项目已删除，但文件夹删除失败：${
        error instanceof Error ? error.message : "未知错误"
      }`;
    }
  }
  const remaining = (await repository.listCanvases()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return Response.json({
    deleted: true,
    nextProjectId: remaining[0]?.id ?? null,
    folderDeleted,
    ...(warning ? { warning } : {}),
  });
}
