import { ProjectFileAccessError } from "@super-canvas/storage";
import { z } from "zod";
import { MAX_SMALL_JSON_BODY_BYTES, parseJsonRequest, parseRouteIdentifier } from "../../../../../../lib/api-validation";
import { jsonError, publicAsset } from "../../../../../../lib/server";
import { importProjectFiles } from "../../../../../../lib/project-service";

const schema = z.object({ fileIds: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(100) }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseRouteIdentifier((await context.params).id, "项目 ID");
  if (!id.success) return id.response;
  const parsed = await parseJsonRequest(request, schema, MAX_SMALL_JSON_BODY_BYTES);
  if (!parsed.success) return parsed.response;
  try {
    const result = await importProjectFiles(id.data, parsed.data.fileIds);
    return Response.json({ ...result, assets: result.assets.map(publicAsset) });
  } catch (error) { return jsonError(error instanceof ProjectFileAccessError ? error.message : "项目文件导入失败", error instanceof ProjectFileAccessError ? error.status : 500); }
}
