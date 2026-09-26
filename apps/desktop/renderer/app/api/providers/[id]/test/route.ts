import { jsonError, repository } from "../../../../../lib/server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const connection = await repository.getConnection((await context.params).id);
  if (connection?.provider === "cli") {
    const { probeCliConnection } = await import("../../../../../lib/cli-connections-server");
    const response = await probeCliConnection(connection.id, "test");
    if (!response.ok) return response;
    const result = await response.json();
    const state = result.connection?.config?.cliStatus;
    return state?.state === "ready"
      ? Response.json({ ok: true, message: state.message, connection: result.connection,
          models: result.connection.config.modelCatalogModels ?? [], source: "cli-saved", checkedAt: state.checkedAt })
      : jsonError(state?.message || "CLI 尚未就绪", 422);
  }
  const { readProviderModelInventory } = await import("../../../../../lib/provider-model-inventory");
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/test$/u, "/models");
  url.search = "?refresh=1";
  // A connection test reads the directory only. Paid capability verification has
  // a separate, explicit entry point and must never be started by saving defaults.
  const response = await readProviderModelInventory(new Request(url, { signal: request.signal }), context);
  if (!response.ok) return response;
  const status = response.headers.get("X-Model-Scan-Status") ?? undefined;
  if (status === "stale" || status === "failed" || status === "unauthorized")
    return jsonError("历史缓存，本次连接测试失败，请检查地址和 Key", 502);
  const models: unknown = await response.json().catch(() => null);
  if (!Array.isArray(models)) return jsonError("模型列表格式无效，已保留保存的配置", 502);
  return Response.json({
    ok: true,
    message: `连接测试成功，当前 Key 返回 ${models.length} 个模型`,
    modelCount: models.length,
    models,
    status,
    checkedAt: response.headers.get("X-Model-Scan-Checked-At") ?? undefined,
    lastSuccessAt: response.headers.get("X-Model-Scan-Last-Success-At") ?? undefined,
    source: response.headers.get("X-Model-Scan-Source") ?? undefined,
  }, { headers: { "Cache-Control": "no-store" } });
}
