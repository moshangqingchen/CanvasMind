import { loadAgentModels, loadAgentModelCatalogSnapshot } from "../../../../lib/agent-models";
import { agentError } from "../_shared";
export const runtime = "nodejs";
export async function GET(request?: Request) {
  try {
    const includeConnections = request && new URL(request.url).searchParams.get("includeConnections") === "1";
    return Response.json(await (includeConnections ? loadAgentModelCatalogSnapshot() : loadAgentModels()),
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return agentError(e);
  }
}
/** Legacy clients must not rewrite a shared image connection's protocol. */
export async function PATCH() {
  return Response.json({ error: "模型能力与调用协议现在自动识别；请在供应商管理中更新 Key 或刷新模型。" }, { status: 410 });
}
