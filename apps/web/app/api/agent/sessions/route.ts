import { z } from "zod";
import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../lib/api-validation";
import {
  createAgentSession,
  listAgentSessions,
} from "../../../../lib/agent-service";
import { agentError } from "../_shared";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return Response.json(
      await listAgentSessions(
        z
          .string()
          .min(1)
          .parse(new URL(request.url).searchParams.get("canvasId")),
      ),
    );
  } catch (e) {
    return agentError(e);
  }
}
export async function POST(request: Request) {
  const p = await parseJsonRequest(
    request,
    z.object({ canvasId: z.string().min(1).max(256) }).strict(),
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  try {
    return Response.json(await createAgentSession(p.data.canvasId));
  } catch (e) {
    return agentError(e);
  }
}
