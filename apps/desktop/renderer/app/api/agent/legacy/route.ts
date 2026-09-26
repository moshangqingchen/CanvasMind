import { z } from "zod";
import { listLegacyAgentHistory } from "../../../../lib/agent-service";
import { agentError } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const canvasId = z.string().min(1).max(256).parse(new URL(request.url).searchParams.get("canvasId"));
    return Response.json(await listLegacyAgentHistory(canvasId));
  } catch (error) {
    return agentError(error);
  }
}
