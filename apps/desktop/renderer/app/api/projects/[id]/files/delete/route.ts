import { ProjectFileAccessError } from "@super-canvas/storage";
import { z } from "zod";
import { MAX_SMALL_JSON_BODY_BYTES, parseJsonRequest, parseRouteIdentifier } from "../../../../../../lib/api-validation";
import { jsonError } from "../../../../../../lib/server";
import { deleteProjectFiles } from "../../../../../../lib/project-service";

const schema = z.object({ fileIds: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(100) }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseRouteIdentifier((await context.params).id, "项目 ID");
  if (!id.success) return id.response;
  const parsed = await parseJsonRequest(request, schema, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  try {
    const result = await deleteProjectFiles(id.data, parsed.data.fileIds);
    const failedAll = !result.deletedIds.length && result.failed.length > 0;
    return Response.json({ ...result, ...(failedAll ? { error: "所选文件已变化或无法删除，请刷新后重试" } : {}) }, { status: failedAll ? 409 : 200 });
  }
  catch (error) { return jsonError(error instanceof ProjectFileAccessError ? error.message : "项目文件删除失败", error instanceof ProjectFileAccessError ? error.status : 500); }
}
