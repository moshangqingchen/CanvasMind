import "server-only";
import {
  decryptSecret,
  loginSupplierSite,
  supplierDirectoryBase,
  SupplierLoginError,
} from "@super-canvas/providers";
import type { SupplierRecord, SupplierState } from "@super-canvas/db";
import { requireServerMasterKey } from "./master-key";

type SiteLogin = NonNullable<SupplierState["siteLogin"]>;
type Site = Pick<SupplierRecord, "siteUrl" | "kind" | "state">;
const safeLoginMessages: Record<SupplierLoginError["code"], string> = {
  invalid_credentials: "站点登录失败，请检查账号和密码",
  invalid_token: "站点访问令牌无效或已过期，请更新令牌",
  permission_denied: "站点访问令牌没有读取账号信息的权限",
  user_id_required: "此站点需要用户 ID，请补充连接配置中的用户 ID",
  verification_required: "站点要求登录验证，请先在供应商网站完成验证",
  unsupported_platform: "暂时无法识别此站点的认证方式",
  invalid_configuration: "请检查连接配置中的站点认证",
  rate_limited: "站点限制了读取频率，请稍后重试",
  network: "站点暂时不可达，请检查网络并稍后重试",
};

/** Credentials may only be used at the exact normalized site they were saved for. */
export function currentSupplierSiteLogin(site: Pick<Site, "siteUrl" | "state">): SiteLogin | undefined {
  const login = site.state?.siteLogin;
  return login && login.siteUrl === supplierDirectoryBase(site.siteUrl) ? login : undefined;
}

/** Cache identity uses ciphertext, never the decrypted password or access token. */
export function supplierSiteLoginCacheIdentity(login: SiteLogin | undefined) {
  if (!login) return null;
  return login.authMode === "access-token"
    ? ["access-token", login.encryptedAccessToken, login.userId ?? null]
    : ["password", login.username, login.encryptedPassword];
}

/** Request-local authenticated session; no plaintext is returned to a public DTO. */
export async function openSupplierSiteSession(site: Site) {
  const login = currentSupplierSiteLogin(site);
  if (!login) return undefined;
  try {
    const credentials = login.authMode === "access-token"
      ? { accessToken: decryptSecret(login.encryptedAccessToken, requireServerMasterKey()),
          ...(login.userId ? { userId: login.userId } : {}) }
      : { username: login.username, password: decryptSecret(login.encryptedPassword, requireServerMasterKey()) };
    return await loginSupplierSite({ siteUrl: site.siteUrl, kind: site.kind, credentials });
  } catch (error) {
    // Preserve classification without trusting an upstream message to omit
    // credentials. Unknown crypto/network errors are also never echoed.
    if (error instanceof SupplierLoginError) {
      const trustedIdMessages = [
        "用户 ID 与访问令牌对应账号不一致或格式不正确，请检查后台用户 ID",
        "用户 ID 与访问令牌对应账号不一致，请检查后台用户 ID",
      ];
      const message = error.code === "invalid_configuration" && trustedIdMessages.includes(error.message)
        ? error.message : safeLoginMessages[error.code];
      throw new SupplierLoginError(message, error.status, error.code);
    }
    throw new SupplierLoginError("站点认证未完成，请检查连接配置或稍后重试", 400, "invalid_configuration");
  }
}
