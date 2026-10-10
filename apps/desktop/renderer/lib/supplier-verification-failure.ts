import type { SupplierVerificationCase, VerificationCharge } from "@super-canvas/db";

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const chargeAmount = (value: unknown): number | undefined => {
  if (typeof value !== "number" && !(typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim()))) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
};
const chargeCurrency = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
// A usage total is a request sample. Only an explicit image billing unit makes it a per-image sample.
const chargeUnit = (row: Record<string, unknown>): VerificationCharge["unit"] =>
  ["image", "per-image", "per_image"].includes(String(row.billing_unit ?? row.billingUnit ?? row.unit ?? "").toLowerCase()) ? "image" : "request";

/** Costs returned by this request are usable even without website login. */
export function chargeFromVerificationResponse(test: SupplierVerificationCase): VerificationCharge | undefined {
  const root = object(test.task?.result);
  if (!root) return undefined;
  const data = object(root.data);
  for (const row of [object(root.usage), object(root.billing), object(data?.usage), object(data?.billing), data, root]) {
    if (!row) continue;
    const amount = chargeAmount(row.actual_cost ?? row.actualCost ?? row.cost);
    const currency = chargeCurrency(row.currency ?? data?.currency ?? root.currency);
    if (amount === undefined || !currency) continue;
    return { amount, currency, unit: chargeUnit(row), checkedAt: new Date().toISOString(), requestId: test.requestId,
      ...(typeof test.task?.providerTaskId === "string" ? { taskId: test.task.providerTaskId } : {}) };
  }
  return undefined;
}

/** Read only a ledger row tied to this exact request/task; never use account totals or a nearby row. */
export function chargeFromVerificationUsage(payload: unknown, test: SupplierVerificationCase,
  kind: "newapi" | "sub2api", sourceUrl: string): VerificationCharge | undefined {
  const root = object(payload);
  if (!root || root.success === false) return undefined;
  const data = object(root.data);
  const rows = Array.isArray(root.data) ? root.data : data?.items ?? data?.logs ?? root.items;
  if (!Array.isArray(rows)) return undefined;
  const taskId = typeof test.task?.providerTaskId === "string" ? test.task.providerTaskId : undefined;
  for (const value of rows) {
    const row = object(value);
    if (!row) continue;
    let extra = object(row.other);
    if (typeof row.other === "string") {
      try { extra = object(JSON.parse(row.other)); } catch { /* No request evidence in malformed metadata. */ }
    }
    const request = row.request_id ?? row.requestId ?? extra?.request_id ?? extra?.requestId;
    const task = row.task_id ?? row.taskId ?? extra?.task_id ?? extra?.taskId;
    if (request !== test.requestId && !(taskId && task === taskId)) continue;
    const cost = chargeAmount(row.actual_cost ?? row.actualCost ?? row.cost);
    const quota = chargeAmount(row.quota);
    const costCurrency = chargeCurrency(row.currency);
    const declaredCost = cost !== undefined && costCurrency !== undefined;
    const amount = declaredCost ? cost : quota ?? (kind === "sub2api" ? cost : undefined);
    const currency = declaredCost ? costCurrency : quota !== undefined ? "quota"
      : kind === "sub2api" && cost !== undefined ? "credits" : undefined;
    if (amount === undefined || !currency) continue;
    return { amount, currency, unit: chargeUnit(row), sourceUrl, checkedAt: new Date().toISOString(),
      ...(request === test.requestId ? { requestId: test.requestId } : {}),
      ...(taskId && task === taskId ? { taskId } : {}) };
  }
  return undefined;
}

/** Compare a single-image request total with its documented image rate without changing the stored sample unit. */
export function verificationChargeForComparison(test: SupplierVerificationCase, charge: VerificationCharge | undefined): VerificationCharge | undefined {
  return charge?.unit === "request" && test.expectedCharge?.unit === "image" && test.parameters?.n === 1
    ? { ...charge, unit: "image" } : charge;
}

/** An absent/late bill is not proof of a free request. */
export function confirmedFreeCharge(charge: VerificationCharge | undefined, test: SupplierVerificationCase): boolean {
  return charge?.amount === 0 && (charge.requestId === test.requestId ||
    (typeof test.task?.providerTaskId === "string" && charge.taskId === test.task.providerTaskId));
}

export function verificationFailure(error: unknown) {
  const details = (error as { details?: { status?: number; responseBody?: unknown } })?.details;
  let body = details?.responseBody;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { /* Plain-text errors are also evidence. */ }
  const row = object(body) ?? {};
  const data = object(row.data);
  const nested = object(row.error) ?? object(data?.error) ?? data ?? row;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "请求失败";
  const text = message + " " + JSON.stringify(body ?? "");
  const unavailable = /no[_ -]?(?:available[_ -]?)?(?:accounts?|channels?)|no healthy upstream|account[_ -]?pool.*(?:empty|exhausted)|(?:没有|暂无|无).{0,8}(?:可用|在线)?(?:账号|帐号|账户|号源|渠道)|号池.{0,6}(?:空|耗尽)|供应商.{0,6}没号/iu.test(text)
    || /(?:upstream|supplier|channel|上游|供应商|通道|号池).{0,48}(?:insufficient.{0,16}(?:balance|quota|credit)|(?:balance|quota|credit).{0,24}(?:insufficient|exhausted)|quota exhausted|余额不足|额度不足|账号耗尽)/iu.test(text);
  const code = String(nested.code ?? row.code ?? nested.type ?? "").trim().toLowerCase();
  const balanceCode = /^(?:insufficient_(?:user_)?(?:quota|balance|credits?)|quota_exceeded|billing_hard_limit(?:_reached)?|credits_exhausted)$/u.test(code);
  const permission = /^(?:auth_insufficient_privilege|permission_denied|access_denied|insufficient_permissions?|invalid_api_key|invalid_access_token|unauthorized|forbidden)$/u.test(code)
    || /permission denied|access denied|insufficient permission|权限不足|无(?:此|访问|调用)?权限/iu.test(String(nested.message ?? row.message ?? ""));
  // Some suppliers use HTTP 403 for a precharge balance check, even with a valid Key.
  // An upstream pool's funds and an account permission denial are not a recharge request.
  const balance = !unavailable && (balanceCode || !permission && (details?.status === 402
    || /insufficient[_ -]?(?:user[_ -]?)?(?:balance|quota|credits?|funds)|quota exceeded|billing hard limit|credits exhausted|balance not enough|not enough balance|payment required|余额不足|余额不够|额度不足|可用额度不足|账户欠费|请充值|充值后重试/iu.test(text)));
  const authentication = !balance && !unavailable && (permission || details?.status === 401 || details?.status === 403);
  const invalid = !unavailable && !balance && /(?:unsupported|not supported|does not support|invalid|不支持|无效|不接受)/iu.test(text);
  const quality = invalid && /quality|质量|品质/iu.test(text);
  const resolution = invalid && /size|resolution|尺寸|分辨率/iu.test(text);
  const rawAllowed = nested.allowed_values ?? nested.supported_values ?? nested.enum;
  const allowed = Array.isArray(rawAllowed) ? rawAllowed.filter((value): value is string => typeof value === "string") : undefined;
  const rejectedParameter = quality ? "quality" as const : resolution ? "resolution" as const : undefined;
  return {
    unavailable, balance, rejectedParameter, allowed, authentication,
    // Explicit flags are meaningful only on a terminal error response.
    free: nested.charged === false || nested.billed === false || nested.no_charge === true || row.charged === false || row.billed === false,
    definiteReason: balance ? "账户余额不足" : authentication ? "鉴权失败，请检查当前分组 Key" : undefined,
    terminal: details?.status !== undefined && details.status !== 408 && details.status !== 504,
  };
}
