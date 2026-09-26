import { z } from "zod";
import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../../lib/api-validation";
import { AgentProposalSchema } from "../../../../../lib/agent-contracts";
import {
  getAgentPlan,
  publicAgentPlan,
  reviseAgentPlan,
  cancelAgentPlan,
} from "../../../../../lib/agent-service";
import { agentError } from "../../_shared";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, c: Context) {
  try {
    return Response.json(
      publicAgentPlan(await getAgentPlan((await c.params).id)),
    );
  } catch (e) {
    return agentError(e);
  }
}
export async function PATCH(request: Request, c: Context) {
  const p = await parseJsonRequest(
    request,
    z
      .object({
        version: z.number().int().positive(),
        proposal: AgentProposalSchema,
      })
      .strict(),
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  try {
    return Response.json(
      await reviseAgentPlan(
        (await c.params).id,
        p.data.version,
        p.data.proposal,
      ),
    );
  } catch (e) {
    return agentError(e);
  }
}
export async function DELETE(request: Request, c: Context) {
  const p = await parseJsonRequest(
    request,
    z.object({ version: z.number().int().positive() }).strict(),
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  try {
    return Response.json(
      await cancelAgentPlan((await c.params).id, p.data.version),
    );
  } catch (e) {
    return agentError(e);
  }
}
