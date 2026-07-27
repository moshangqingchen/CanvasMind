import {
  decryptSecret,
  fetchProviderJson,
  joinUrl,
  type ModelDescriptor,
} from "@super-canvas/providers";
import { getRunService, type RunService } from "@super-canvas/runtime";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { requireServerMasterKey } from "../../../../../lib/master-key";
import { repository, jsonError } from "../../../../../lib/server";
import { syncCangyuanConnection } from "../../../../../lib/cangyuan-catalog";

function adapterFor(service: RunService, provider: string) {
  const anyService = service as unknown as {
    adapters?: () => Map<string, unknown>;
  };
  return anyService.adapters?.()?.get(provider);
}

interface OpenAIModelList {
  data?: Array<{ id?: unknown }>;
}

function configuredStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : [],
  );
}

async function listAgentModels(connection: {
  encryptedSecret?: string | null;
  config: Record<string, unknown>;
}): Promise<ModelDescriptor[]> {
  const baseUrl =
    typeof connection.config.baseUrl === "string"
      ? connection.config.baseUrl.trim()
      : "";
  if (!baseUrl) throw new Error("missing base URL");
  if (!connection.encryptedSecret) throw new Error("missing API key");
  const apiKey = decryptSecret(
    connection.encryptedSecret,
    requireServerMasterKey(),
  );
  const response = await fetchProviderJson<OpenAIModelList>(
    fetch,
    joinUrl(baseUrl, "/models"),
    {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
    {
      phase: "connect",
      timeoutMs: 20_000,
      allowLoopback: connection.config.allowLocalhost === true,
    },
  );
  const available = new Set(
    (response.data ?? []).flatMap((item) =>
      typeof item.id === "string" && item.id.trim() ? [item.id.trim()] : [],
    ),
  );
  const allowed = configuredStrings(connection.config.allowedModels);
  const ids = (allowed.length > 0 ? allowed : [...available]).filter(
    (id) =>
      available.has(id) &&
      id !== "codex-auto-review" &&
      !id.toLowerCase().includes("image"),
  );
  const defaultModel =
    typeof connection.config.defaultModel === "string"
      ? connection.config.defaultModel.trim()
      : "";
  const names =
    connection.config.modelNames &&
    typeof connection.config.modelNames === "object" &&
    !Array.isArray(connection.config.modelNames)
      ? (connection.config.modelNames as Record<string, unknown>)
      : {};
  return ids.map((id) => ({
    id,
    name: typeof names[id] === "string" ? names[id] : id,
    operations: [],
    provider: "openai",
    capabilities: [],
    inputKinds: ["text", "image"],
    outputKinds: ["text"],
    isDefault: id === defaultModel,
  }));
}

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  let connection = await repository.getConnection(id);
  if (!connection) return jsonError("供应商连接不存在", 404);
  connection = (await syncCangyuanConnection(id)) ?? connection;
  if (connection.config.usage === "agent") {
    try {
      return Response.json(await listAgentModels(connection), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return jsonError("对话模型列表读取失败，请检查地址、密钥和模型权限", 502);
    }
  }
  const adapter = adapterFor(getRunService(), connection.provider);
  if (!adapter || typeof adapter !== "object" || !("listModels" in adapter))
    return jsonError("供应商适配器不可用", 422);
  try {
    return Response.json(
      await (
        adapter as { listModels: (id: string) => Promise<unknown> }
      ).listModels(id),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError("模型列表读取失败，请检查供应商连接", 502);
  }
}
