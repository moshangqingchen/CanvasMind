import { getRunService, type RunService } from "@super-canvas/runtime";
import {
  CredentialError,
  ProviderHttpError,
  decryptSecret,
} from "@super-canvas/providers";
import { parseRouteIdentifier } from "../../../../../lib/api-validation";
import { loadCangyuanCatalog } from "../../../../../lib/cangyuan-catalog";
import { requireServerMasterKey } from "../../../../../lib/master-key";
import { repository, jsonError } from "../../../../../lib/server";

function adapterFor(service: RunService, provider: string) {
  const anyService = service as unknown as {
    adapters?: () => Map<string, unknown>;
  };
  return anyService.adapters?.()?.get(provider);
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
      if (error.details.kind === "authentication")
        return jsonError(
          "沧元拒绝了当前 API Key，请检查令牌是否有效、过期或受分组权限限制。",
          401,
        );
      if (error.details.status === 404)
        return jsonError(
          "供应商不支持当前无扣费检测端点；密钥尚未判定为无效。",
          422,
        );
      if (error.details.kind === "timeout" || error.details.kind === "network")
        return jsonError("连接沧元时网络超时或不可达，请稍后重试。", 502);
      return jsonError(
        `沧元连接检测失败${error.details.status ? `（HTTP ${error.details.status}）` : ""}。`,
        502,
      );
    }
    return jsonError("连接测试失败，请检查密钥、地址和供应商配置", 502);
  }
}
