import {
  ProviderConnectionRequestSchema,
  parseJsonRequest,
} from "../../../lib/api-validation";
import {
  repository,
  jsonError,
  maskConnection,
  saveProviderConnection,
} from "../../../lib/server";
import {
  syncAllCangyuanConnections,
  syncCangyuanConnection,
} from "../../../lib/cangyuan-catalog";

export async function GET() {
  await syncAllCangyuanConnections();
  return Response.json(
    (await repository.listConnections()).map((connection) =>
      maskConnection(connection),
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(
    request,
    ProviderConnectionRequestSchema,
  );
  if (!parsed.success) return parsed.response;

  try {
    let connection = await saveProviderConnection({
      id: parsed.data.id,
      name: parsed.data.name,
      provider: parsed.data.provider,
      apiKey: parsed.data.apiKey,
      config: parsed.data.config ?? {},
    });
    if (connection.config.preset === "cangyuan-gpt-image-2") {
      connection = (await syncCangyuanConnection(connection.id)) ?? connection;
    }
    return Response.json(maskConnection(connection), {
      status: parsed.data.id ? 200 : 201,
    });
  } catch {
    return jsonError("供应商连接保存失败", 500);
  }
}
