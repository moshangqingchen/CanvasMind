import { z } from "zod";
import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../lib/api-validation";
import { AgentProposalSchema } from "../../../../lib/agent-contracts";
import { createAgentPlan } from "../../../../lib/agent-service";
import { agentError } from "../_shared";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const p = await parseJsonRequest(
    request,
    z
      .object({
        sessionId: z.string().min(1),
        proposal: AgentProposalSchema,
        selectedNodeIds: z.array(z.string()).max(100).default([]),
      })
      .strict(),
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  try {
    return Response.json(
      await createAgentPlan(
        p.data.sessionId,
        p.data.proposal,
        p.data.selectedNodeIds,
      ),
    );
  } catch (e) {
    return agentError(e);
  }
}
