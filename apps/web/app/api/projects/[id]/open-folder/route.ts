import { spawn } from "node:child_process";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError, repository } from "../../../../../lib/server";
import { ensureProjectDirectory } from "../../../../../lib/project-service";
import { getProjectFileStore } from "@super-canvas/storage";

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "项目 ID");
  if (!parsedId.success) return parsedId.response;

  const canvas = await repository.getCanvas(parsedId.data);
  if (!canvas) return jsonError("项目不存在", 404);

  try {
    await ensureProjectDirectory(canvas);
    const directory = getProjectFileStore().projectDirectory(canvas.title);
    if (process.platform !== "win32") {
      return Response.json({
        opened: false,
        error: "当前环境不支持自动打开项目文件夹",
      });
    }

    const child = spawn("explorer.exe", [directory], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return Response.json({ opened: true });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "项目文件夹打开失败",
      500,
    );
  }
}
