import { SupplierLoginError } from "@super-canvas/providers";
import { SupplierConflictError, type SupplierBillingSnapshot } from "@super-canvas/db";
import { repository } from "./server";
import { getSupplierRecord, SupplierServiceError } from "./supplier-service";
import { readSupplierBilling } from "./supplier-billing-read";
import { currentSupplierSiteLogin, openSupplierSiteSession } from "./supplier-site-session";

const pending = new Map<string, Promise<SupplierBillingSnapshot>>();
export function refreshSupplierBilling(id: string): Promise<SupplierBillingSnapshot> {
  const current = pending.get(id);
  if (current) return current;
  const task = refresh(id).finally(() => { if (pending.get(id) === task) pending.delete(id); });
  pending.set(id, task);
  return task;
}
async function refresh(id: string) {
  const supplier = await getSupplierRecord(id);
  if (!supplier?.state || supplier.state.visibility === "deleted") throw new SupplierServiceError("供应商不存在", 404);
  const sourceId = supplier.state.sourceId, login = supplier.state.siteLogin;
  const previous = supplier.state.billing?.sourceId === sourceId ? supplier.state.billing : undefined;
  let billing: SupplierBillingSnapshot;
  if (!currentSupplierSiteLogin(supplier)) {
    billing = { sourceId, status: "unconfigured", checkedAt: new Date().toISOString(), unit: "credits", sourceUrl: supplier.siteUrl,
      error: "请在连接配置中保存站点认证，才能读取账号余额与消耗；分组 Key 不等于账号余额" };
  } else {
    try {
      const session = (await openSupplierSiteSession(supplier))!;
      billing = await readSupplierBilling({ siteUrl: supplier.siteUrl, sourceId, kind: session.kind }, session.fetch);
    } catch (error) {
      const trustedIdMessage = error instanceof SupplierLoginError && error.code === "invalid_configuration" && [
        "用户 ID 与访问令牌对应账号不一致或格式不正确，请检查后台用户 ID",
        "用户 ID 与访问令牌对应账号不一致，请检查后台用户 ID",
      ].includes(error.message) ? error.message : undefined;
      const reason = trustedIdMessage ?? (error instanceof SupplierLoginError ? ({
        network: "站点暂时不可达，请稍后重新读取", rate_limited: "站点限制了读取频率，请稍后重试",
        invalid_credentials: "站点登录已失效，请更新连接配置中的账号密码", verification_required: "站点要求登录验证，请先在供应商网站完成验证",
        invalid_token: "站点访问令牌无效或已过期，请更新连接配置中的令牌", permission_denied: "此站点访问令牌没有读取账号信息的权限",
        user_id_required: "此站点需要用户 ID，请补充连接配置中的用户 ID",
        unsupported_platform: "暂时无法识别此站点的账务接口", invalid_configuration: "请检查连接配置中的站点登录",
      })[error.code] : "读取失败，请检查站点登录或稍后重试");
      billing = { ...previous, sourceId, status: "failed", checkedAt: new Date().toISOString(), unit: previous?.unit ?? "credits",
        sourceUrl: previous?.sourceUrl ?? supplier.siteUrl, error: `${reason}；${previous?.lastSuccessAt ? "上次成功数据已保留" : "尚未取得有效账务数据"}` };
    }
  }
  // Re-read after network IO; never overwrite a concurrent scan, edit, source switch or login change.
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await repository.getSupplier(id);
    if (!latest?.state || latest.state.visibility === "deleted" || latest.state.sourceId !== sourceId ||
      latest.siteUrl !== supplier.siteUrl || latest.kind !== supplier.kind || JSON.stringify(latest.state.siteLogin) !== JSON.stringify(login)) throw new SupplierConflictError();
    const owned = (await repository.listConnections()).filter(connection => connection.config.supplierId === id);
    try {
      await repository.commitSupplier({ supplier: { ...latest, state: { ...latest.state, billing, revision: latest.state.revision + 1 } },
        expectedRevision: latest.state.revision, expectedConnections: owned, connections: [] });
      return billing;
    } catch (error) { if (!(error instanceof SupplierConflictError) || attempt === 2) throw error; }
  }
  throw new SupplierConflictError();
}
