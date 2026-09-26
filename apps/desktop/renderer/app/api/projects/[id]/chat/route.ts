import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { jsonError, repository } from "../../../../../lib/server";
import {
  clearProjectChat,
  listProjectChatMessages,
} from "../../../../../lib/project-service";

async function projectId(context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return parseRouteIdentifier(params.id, "项目 ID");
}

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedId = await projectId(context);
  if (!parsedId.success) return parsedId.response;
  if (!(await repository.getCanvas(parsedId.data))) return jsonError("项目不存在", 404);
  try {
    return Response.json({ messages: await listProjectChatMessages(parsedId.data) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "项目对话读取失败", 500);
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedId = await projectId(context);
  if (!parsedId.success) return parsedId.response;
  if (!(await repository.getCanvas(parsedId.data))) return jsonError("项目不存在", 404);
  try {
    await clearProjectChat(parsedId.data);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "项目对话清理失败", 500);
  }
}
