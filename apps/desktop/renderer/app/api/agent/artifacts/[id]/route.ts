import { z } from "zod";
import { AgentArtifactSchema } from "../../../../../lib/agent-contracts";
import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../../lib/api-validation";
import { getAgentSession } from "../../../../../lib/agent-service";
import { repository } from "../../../../../lib/server";
import { agentError } from "../../_shared";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  const p = await parseJsonRequest(
    request,
    z.object({ artifact: AgentArtifactSchema }).strict(),
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  try {
    const message = await repository.getDirectorMessage((await c.params).id);
    if (!message || message.metadata.kind !== "artifact")
      throw new Error("成果不存在");
    await getAgentSession(message.sessionId);
    await repository.updateDirectorMessage(message.id, {
      metadata: { ...message.metadata, artifact: p.data.artifact },
    });
    return Response.json({ saved: true });
  } catch (e) {
    return agentError(e);
  }
}
