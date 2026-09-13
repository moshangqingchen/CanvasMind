import {
  getAgentSession,
  stopAgentTurn,
} from "../../../../../lib/agent-service";
import { agentError } from "../../_shared";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(await getAgentSession((await context.params).id));
  } catch (e) {
    return agentError(e);
  }
}
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await stopAgentTurn((await context.params).id);
    return Response.json({ stopped: true });
  } catch (e) {
    return agentError(e);
  }
}
