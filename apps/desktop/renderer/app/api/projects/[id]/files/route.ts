import { ProjectFileAccessError } from "@super-canvas/storage";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError } from "../../../../../lib/server";
import { listProjectFiles } from "../../../../../lib/project-service";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseRouteIdentifier((await context.params).id, "项目 ID");
  if (!id.success) return id.response;
  try { return Response.json(await listProjectFiles(id.data), { headers: { "cache-control": "private, no-store" } }); }
  catch (error) { return jsonError(error instanceof ProjectFileAccessError ? error.message : "项目文件读取失败", error instanceof ProjectFileAccessError ? error.status : 500); }
}
