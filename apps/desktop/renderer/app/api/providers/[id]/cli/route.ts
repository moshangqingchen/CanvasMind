import { z } from "zod";
import { parseJsonRequest, parseRouteIdentifier, MAX_SMALL_JSON_BODY_BYTES } from "../../../../../lib/api-validation";
import { probeCliConnection } from "../../../../../lib/cli-connections-server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseRouteIdentifier((await context.params).id, "连接 ID");
  if (!id.success) return id.response;
  const parsed = await parseJsonRequest(request, z.object({ action: z.enum(["test", "describe"]) }).strict(), MAX_SMALL_JSON_BODY_BYTES);
  return parsed.success ? probeCliConnection(id.data, parsed.data.action) : parsed.response;
}
