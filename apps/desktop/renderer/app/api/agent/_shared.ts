import { ZodError } from "zod";
import { AgentError } from "../../../lib/agent-service";
import { safeAgentError } from "../../../lib/agent-errors";
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
  const message = safeAgentError(error).message;
  return Response.json(
    { error: message },
    { status: error instanceof AgentError ? error.status : 400 },
  );
}
