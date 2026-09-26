import { z } from "zod";
import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../../../lib/api-validation";
import { materializeAgentPlan } from "../../../../../../lib/agent-service";
import { agentError } from "../../../_shared";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  const p = await parseJsonRequest(
    request,
    z
      .object({
        version: z.number().int().positive(),
        canvasRevision: z.number().int().min(0),
      })
      .strict(),
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  try {
    return Response.json(
      await materializeAgentPlan(
        (await c.params).id,
        p.data.version,
        p.data.canvasRevision,
      ),
    );
  } catch (e) {
    return agentError(e);
  }
}
