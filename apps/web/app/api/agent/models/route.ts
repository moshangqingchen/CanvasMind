import { z } from "zod";
import type { JsonObject } from "@super-canvas/db";
import {
  parseJsonRequest,
  MAX_SMALL_JSON_BODY_BYTES,
} from "../../../../lib/api-validation";
import { AGENT_PROTOCOLS, loadAgentModels } from "../../../../lib/agent-models";
import { repository } from "../../../../lib/server";
import { agentError } from "../_shared";
export const runtime = "nodejs";
export async function GET() {
  try {
    return Response.json(await loadAgentModels());
  } catch (e) {
    return agentError(e);
  }
}
export async function PATCH(request: Request) {
  const p = await parseJsonRequest(
    request,
    z
      .object({
        connectionId: z.string().min(1),
        modelId: z.string().min(1).max(256),
        protocol: z.enum(AGENT_PROTOCOLS).optional(),
        capabilities: z
          .object({
            imageInput: z.boolean(),
            audioInput: z.boolean(),
            videoInput: z.boolean(),
            structuredOutput: z.boolean(),
            toolCalling: z.boolean(),
            reasoning: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    MAX_SMALL_JSON_BODY_BYTES,
  );
  if (!p.success) return p.response;
  try {
    const c = await repository.getConnection(p.data.connectionId);
    if (!c || c.config.usage !== "agent") throw new Error("请选择智能体连接");
    const perModel =
      c.config.agentModelCapabilities &&
      typeof c.config.agentModelCapabilities === "object"
        ? c.config.agentModelCapabilities
        : {};
    const config: JsonObject = {
      ...c.config,
      ...(p.data.protocol
        ? {
            protocol: p.data.protocol,
            directorProtocol:
              p.data.protocol === "responses"
                ? "openai-responses"
                : p.data.protocol === "chat-completions"
                  ? "openai-chat-completions"
                  : p.data.protocol,
          }
        : {}),
      agentModelCapabilities: {
        ...perModel,
        [p.data.modelId]: {
          ...p.data.capabilities,
          text: true,
          nativeWebSearch: false,
          probeSource: "manual",
        },
      },
    };
    if (p.data.protocol && Array.isArray(config.manualModels)) {
      config.manualModels = config.manualModels.map((raw) => {
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          raw.capability !== "chat"
        )
          return raw;
        return { ...raw, protocol: p.data.protocol! };
      });
    }
    await repository.saveConnection({
      id: c.id,
      name: c.name,
      provider: c.provider,
      config,
      encryptedSecret: c.encryptedSecret,
    });
    return Response.json(await loadAgentModels());
  } catch (e) {
    return agentError(e);
  }
}
