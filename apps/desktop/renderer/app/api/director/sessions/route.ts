import {
  searchParamsToObject,
  validationError,
  MAX_SMALL_JSON_BODY_BYTES,
  parseJsonRequest,
} from "../../../../lib/api-validation";
import {
  createDirectorConversation,
  DirectorServiceError,
  getDirectorConversation,
  listDirectorConversations,
} from "../../../../lib/director-service";
import {
  DirectorSessionCreateSchema,
  DirectorSessionsQuerySchema,
} from "../_schemas";
import { directorErrorResponse } from "../_shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    DirectorSessionCreateSchema,
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!parsed.success) return parsed.response;
  try {
    return Response.json({
      conversation: await createDirectorConversation(parsed.data.canvasId),
    });
  } catch (error) {
    return directorErrorResponse(error);
  }
}

export async function GET(request: Request) {
  const query = DirectorSessionsQuerySchema.safeParse(
    searchParamsToObject(new URL(request.url).searchParams),
  );
  if (!query.success) return validationError(query.error, "导演会话查询无效");

  try {
    if (query.data.sessionId) {
      const conversation = await getDirectorConversation(query.data.sessionId);
      if (conversation.session.canvasId !== query.data.canvasId) {
        throw new DirectorServiceError(
          "SESSION_NOT_FOUND",
          "当前画布中不存在该导演会话",
          404,
        );
      }
      return Response.json({ conversation });
    }

    const conversations = await listDirectorConversations(query.data.canvasId);
    return Response.json({
      conversation: conversations[0] ?? null,
      conversations,
    });
  } catch (error) {
    return directorErrorResponse(error);
  }
}
