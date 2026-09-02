import { CanvasRevisionConflictError } from "@super-canvas/db";
import { getProjectFileStore } from "@super-canvas/storage";
import { z } from "zod";
import {
  MAX_SMALL_JSON_BODY_BYTES,
  parseJsonRequest,
  parseRouteIdentifier,
} from "../../../../lib/api-validation";
import { jsonError, repository, safeJsonObject } from "../../../../lib/server";
import {
  normalizedProjectTitle,
  projectSummary,
} from "../../../../lib/project-service";

const activeRunStatuses = new Set(["queued", "running"]);
const RenameProjectSchema = z
  .object({ title: z.string().trim().min(1).max(160) })
  .strict();

function normalizedTitleKey(title: string): string {
  return normalizedProjectTitle(title).normalize("NFC").toLocaleLowerCase();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "项目 ID");
  if (!parsedId.success) return parsedId.response;
  const parsed = await parseJsonRequest(
    request,
    RenameProjectSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;

  const canvas = await repository.getCanvas(parsedId.data);
  if (!canvas) return jsonError("项目不存在", 404);
  const title = parsed.data.title.trim();
  if (title === canvas.title)
    return Response.json({
      project: projectSummary(canvas),
      revision: canvas.revision,
      folderRenamed: false,
    });

  const canvases = await repository.listCanvases();
  const nextTitleKey = normalizedTitleKey(title);
  if (
    canvases.some(
      (other) =>
        other.id !== canvas.id && normalizedTitleKey(other.title) === nextTitleKey,
    )
  )
    return jsonError("项目名称已存在，请换一个名称", 409);

  const runs = await repository.listRuns(canvas.id);
  if (runs.some((run) => activeRunStatuses.has(run.status)))
    return jsonError("当前项目仍有生成任务运行，请等待任务结束后再重命名", 409);

  const currentFolderName = normalizedProjectTitle(canvas.title);
  const nextFolderName = normalizedProjectTitle(title);
  const folderNameChanged = currentFolderName !== nextFolderName;
  if (
    folderNameChanged &&
    canvases.some(
      (other) =>
        other.id !== canvas.id &&
        normalizedTitleKey(other.title) === normalizedTitleKey(canvas.title),
    )
  )
    return jsonError(
      "该历史项目与另一个同名项目共用文件夹，请先删除或处理其中一个项目",
      409,
    );

  const projectFiles = getProjectFileStore();
  let folderRenamed = false;
  try {
    folderRenamed = await projectFiles.renameProject(canvas.title, title);
  } catch (error) {
    return jsonError(
      `项目文件夹重命名失败：${
        error instanceof Error ? error.message : "未知错误"
      }`,
      409,
    );
  }

  try {
    const saved = await repository.saveCanvas({
      id: canvas.id,
      title,
      graph: safeJsonObject(canvas.graph),
      reason: "rename",
      expectedRevision: canvas.revision,
    });
    return Response.json({
      project: projectSummary(saved),
      revision: saved.revision,
      folderRenamed,
    });
  } catch (error) {
    if (folderNameChanged)
      await projectFiles.renameProject(title, canvas.title).catch(() => undefined);
    if (error instanceof CanvasRevisionConflictError)
      return jsonError("项目刚刚发生变化，请稍后重试重命名", 409);
    return jsonError("项目重命名失败，项目文件夹已恢复原名", 500);
  }
}

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
  const normalizedTitle = normalizedTitleKey(canvas.title);
  const folderSharedByLegacyProject = canvases.some(
    (other) =>
      other.id !== canvas.id &&
      normalizedTitleKey(other.title) === normalizedTitle,
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
