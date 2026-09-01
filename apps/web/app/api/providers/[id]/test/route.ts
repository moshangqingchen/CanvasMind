import { getRunService, type RunService } from "@super-canvas/runtime";
import {
  CredentialError,
  ProviderHttpError,
  decryptSecret,
  fetchProviderJson,
  joinUrl,
  providerFetch,
} from "@super-canvas/providers";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { loadCangyuanCatalog } from "../../../../../lib/cangyuan-catalog";
import { scanCyberAfeiConnection } from "../../../../../lib/cyberafei-server";
import { FRIMODEL_PRESET_ID } from "../../../../../lib/frimodel-presets";
import { scanFriModelConnection } from "../../../../../lib/frimodel-server";
import { CHENTU_PRESET_ID } from "../../../../../lib/chentu-presets";
import { scanChentuConnection } from "../../../../../lib/chentu-server";
import { scanMikotoConnection } from "../../../../../lib/mikoto-server";
import { scanMiaowuConnection } from "../../../../../lib/miaowu-server";
import { requireServerMasterKey } from "../../../../../lib/master-key";
import { repository, jsonError } from "../../../../../lib/server";

function adapterFor(service: RunService, provider: string) {
  const anyService = service as unknown as {
    adapters?: () => Map<string, unknown>;
  };
  return anyService.adapters?.()?.get(provider);
}

function providerLabel(provider: string): string {
  if (provider === "weai") return "We-AI";
  if (provider === "openai") return "OpenAI";
  if (provider === "runway") return "Runway";
  return "供应商";
}

async function testCustomGroupConnection(connection: {
  encryptedSecret?: string | null;
  config: Record<string, unknown>;
}): Promise<number> {
  const baseUrl =
    typeof connection.config.baseUrl === "string"
      ? connection.config.baseUrl.trim()
      : "";
  if (!baseUrl) throw new Error("未填写 API Base URL");
  if (!connection.encryptedSecret) throw new Error("未填写 API Key");
  const apiKey = decryptSecret(
    connection.encryptedSecret,
    requireServerMasterKey(),
  );
  const urls = [joinUrl(baseUrl, "/models"), joinUrl(baseUrl, "/v1/models")].filter(
    (url, index, all) => all.indexOf(url) === index,
  );
  let lastError: unknown;
  for (const url of urls) {
    try {
      const payload = await fetchProviderJson<{
        data?: Array<{ id?: unknown }>;
        models?: Array<{ id?: unknown; name?: unknown }>;
      }>(
        providerFetch,
        url,
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
      const count =
        (payload.data ?? []).length + (payload.models ?? []).length;
      return count;
    } catch (error) {
      lastError = error;
    }
  }
  throw (lastError ?? new Error("模型接口不可用"));
}

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const parsedId = parseRouteIdentifier(params.id, "连接 ID");
  if (!parsedId.success) return parsedId.response;
  const id = parsedId.data;
  const connection = await repository.getConnection(id);
  if (!connection) return jsonError("供应商连接不存在", 404);
  const adapter = adapterFor(getRunService(), connection.provider);
  if (!adapter || typeof adapter !== "object" || !("testConnection" in adapter))
    return jsonError("供应商适配器不可用", 422);
  try {
    if (connection.config.customGroup === true) {
      const modelCount = await testCustomGroupConnection(connection);
      return Response.json({
        ok: true,
        message: `自定义分组连接成功，已读取 ${modelCount} 个模型；未发起付费请求。`,
      });
    }
    if (connection.config.preset === "cangyuan-gpt-image-2") {
      if (!connection.encryptedSecret)
        throw new CredentialError("Provider API key is not configured");
      decryptSecret(connection.encryptedSecret, requireServerMasterKey());
      const catalog = await loadCangyuanCatalog({ force: true });
      return Response.json({
        ok: true,
        message:
          catalog.source === "fallback"
            ? "API Key 可正常解密；沧元实时目录暂不可用，当前使用备用目录。未发起付费请求。"
            : "API Key 可正常解密，沧元主页、文档和模型目录均可访问。未发起付费请求。",
      });
    }
    if (connection.config.preset === "cyberafei-api") {
      const scan = await scanCyberAfeiConnection(id, { forcePricing: true });
      if (scan.status === "unauthorized")
        return jsonError(scan.error ?? "赛博阿飞拒绝了当前分组 Key。", 401);
      if (scan.status === "unconfigured")
        return jsonError(scan.error ?? "赛博阿飞分组尚未配置 Key。", 409);
      if (scan.status === "failed")
        return jsonError(scan.error ?? "赛博阿飞模型扫描失败。", 502);
      const modelCount = scan.modelIds.length;
      const callableCount = scan.canvasModels.length;
      return Response.json({
        ok: true,
        message: `API Key 鉴权成功，本次实时扫描到 ${modelCount} 个分组模型，其中 ${callableCount} 个已有画布协议；未发起付费生成请求。`,
      });
    }
    if (connection.config.preset === FRIMODEL_PRESET_ID) {
      const scan = await scanFriModelConnection(id);
      if (scan.status === "unauthorized")
        return jsonError(scan.error ?? "FriModel 拒绝了当前 API Key。", 401);
      if (scan.status === "unconfigured")
        return jsonError(scan.error ?? "FriModel 连接尚未配置 Key。", 409);
      if (scan.status === "failed")
        return jsonError(scan.error ?? "FriModel 模型扫描失败。", 502);
      return Response.json({
        ok: true,
        message:
          scan.modelIds.length > 0
            ? `FriModel API Key 鉴权成功；本次实时扫描到 ${scan.modelIds.length} 个可用模型。未发起付费生成请求。`
            : "FriModel API Key 鉴权成功，但当前密钥的模型目录为空；未发起付费生成请求。",
      });
    }
    if (connection.config.preset === CHENTU_PRESET_ID) {
      const scan = await scanChentuConnection(id, { forcePricing: true });
      if (scan.status === "unauthorized")
        return jsonError(scan.error ?? "辰途拒绝了当前分组 Key。", 401);
      if (scan.status === "unconfigured")
        return jsonError(scan.error ?? "辰途分组尚未配置 Key。", 409);
      if (scan.status === "failed")
        return jsonError(scan.error ?? "辰途模型扫描失败。", 502);
      return Response.json({
        ok: true,
        message: `辰途 API Key 鉴权成功，本次实时扫描到 ${scan.modelIds.length} 个分组模型，其中 ${scan.canvasModels.length} 个已有画布协议；实时目录来源：${scan.catalogSource === "live" ? "模型广场实时数据" : scan.catalogSource === "stale" ? "最近一次成功目录" : "内置兜底目录"}。未发起付费生成请求。`,
      });
    }
    if (connection.config.supplierKey === "mikoto") {
      const scan = await scanMikotoConnection(id);
      if (scan.status === "unauthorized")
        return jsonError(
          scan.error ??
            "MikotoPro 拒绝了当前分组 Key（可能分组已停用），请在官网确认后重新填写。",
          401,
        );
      if (scan.status === "unconfigured")
        return jsonError(scan.error ?? "MikotoPro 连接尚未配置 Key。", 409);
      if (scan.status === "failed")
        return jsonError(scan.error ?? "MikotoPro 模型扫描失败。", 502);
      return Response.json({
        ok: true,
        message: `MikotoPro API Key 鉴权成功，本次实时扫描到 ${scan.modelIds.length} 个当前分组可调用的模型；价格采用内置快照，实际扣费以官网为准。未发起付费生成请求。`,
      });
    }
    if (connection.config.supplierKey === "miaowu") {
      const scan = await scanMiaowuConnection(id, { forcePricing: true });
      if (scan.status === "unauthorized")
        return jsonError(scan.error ?? "喵呜拒绝了当前 API Key。", 401);
      if (scan.status === "unconfigured")
        return jsonError(scan.error ?? "喵呜连接尚未配置 Key。", 409);
      if (scan.status === "failed")
        return jsonError(scan.error ?? "喵呜模型扫描失败。", 502);
      return Response.json({
        ok: true,
        message: `喵呜 API Key 鉴权成功，本次实时扫描到 ${scan.modelIds.length} 个当前 Key 可调用的模型，价格已按模型广场实时同步。未发起付费生成请求。`,
      });
    }
    await (
      adapter as { testConnection: (id: string) => Promise<void> }
    ).testConnection(id);
    return Response.json({ ok: true, message: "连接测试成功" });
  } catch (error) {
    if (
      error instanceof CredentialError ||
      (error instanceof Error && error.name === "CredentialError")
    ) {
      return jsonError(
        "已保存的 API 密钥无法解密：服务端主密钥与保存时不一致，请重新填写一次 API Key。",
        409,
      );
    }
    if (error instanceof ProviderHttpError) {
      const label =
        connection.config.preset === FRIMODEL_PRESET_ID
          ? "FriModel"
          : connection.config.preset === CHENTU_PRESET_ID
            ? "辰途 API"
          : connection.config.supplierKey === "mikoto"
            ? "MikotoPro"
            : connection.config.supplierKey === "miaowu"
              ? "喵呜 API"
              : providerLabel(connection.provider);
      if (error.details.kind === "authentication")
        return jsonError(
          `${label} 拒绝了当前 API Key，请检查令牌是否有效、过期或受分组权限限制。`,
          401,
        );
      if (error.details.status === 404)
        return jsonError(
          "供应商不支持当前无扣费检测端点；密钥尚未判定为无效。",
          422,
        );
      if (error.details.kind === "timeout" || error.details.kind === "network")
        return jsonError(`连接 ${label} 时网络超时或不可达，请稍后重试。`, 502);
      return jsonError(
        `${label} 连接检测失败${error.details.status ? `（HTTP ${error.details.status}）` : ""}。`,
        502,
      );
    }
    const detail = error instanceof Error ? error.message.trim() : "";
    return jsonError(
      detail
        ? `连接测试失败：${detail}`
        : "连接测试失败，请检查密钥、地址和供应商配置",
      502,
    );
  }
}
