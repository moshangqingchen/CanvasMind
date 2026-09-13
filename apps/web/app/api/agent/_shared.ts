import { ZodError } from "zod";
import { AgentError } from "../../../lib/agent-service";
export function agentError(error: unknown): Response {
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => i.message)
          .slice(0, 3)
          .join("；"),
      },
      { status: 400 },
    );
  const message =
    error instanceof Error
      ? error.message
          .replace(/Bearer\s+\S+/giu, "Bearer ***")
          .replace(/sk-[\w-]{8,}/gu, "***")
      : "智能体请求失败";
  return Response.json(
    { error: message },
    { status: error instanceof AgentError ? error.status : 400 },
  );
}
