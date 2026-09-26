import { z } from "zod";
import { MAX_SMALL_JSON_BODY_BYTES, parseJsonRequest, parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError, repository } from "../../../../../lib/server";
import { archiveExternalAssetsForProject } from "../../../../../lib/project-service";

const ArchiveSchema = z.object({
  assetIds: z.array(z.string().trim().min(1).max(128)).max(100),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "项目 ID");
  if (!parsedId.success) return parsedId.response;
  const parsed = await parseJsonRequest(request, ArchiveSchema, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  if (!(await repository.getCanvas(parsedId.data))) return jsonError("项目不存在", 404);
  try {
    await archiveExternalAssetsForProject(parsedId.data, parsed.data.assetIds);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "素材归档失败", 500);
  }
}
