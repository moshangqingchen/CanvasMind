import type { SupplierVerificationCase, VerificationCharge } from "@super-canvas/db";

/** Costs returned by this request are usable even without website login. */
export function chargeFromVerificationResponse(test: SupplierVerificationCase): VerificationCharge | undefined {
  const result = test.task?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const root = result as Record<string, unknown>;
  const nested = root.usage ?? root.billing ?? root;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  const row = nested as Record<string, unknown>;
  const amount = row.actual_cost ?? row.cost;
  const currency = row.currency ?? root.currency;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || typeof currency !== "string" || !currency.trim()) return undefined;
  return { amount, currency, unit: "request", checkedAt: new Date().toISOString(), requestId: test.requestId,
    ...(typeof test.task?.providerTaskId === "string" ? { taskId: test.task.providerTaskId } : {}) };
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
  const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const nested = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : row;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "请求失败";
  const text = message + " " + JSON.stringify(body ?? "");
  const unavailable = /no[_ -]?(?:available[_ -]?)?(?:accounts?|channels?)|no healthy upstream|account[_ -]?pool.*(?:empty|exhausted)|(?:没有|暂无|无).{0,8}(?:可用|在线)?(?:账号|帐号|账户|号源|渠道)|号池.{0,6}(?:空|耗尽)|供应商.{0,6}没号/iu.test(text);
  const invalid = !unavailable && /(?:unsupported|not supported|does not support|invalid|不支持|无效|不接受)/iu.test(text);
  const quality = invalid && /quality|质量|品质/iu.test(text);
  const resolution = invalid && /size|resolution|尺寸|分辨率/iu.test(text);
  const rawAllowed = nested.allowed_values ?? nested.supported_values ?? nested.enum;
  const allowed = Array.isArray(rawAllowed) ? rawAllowed.filter((value): value is string => typeof value === "string") : undefined;
  const rejectedParameter = quality ? "quality" as const : resolution ? "resolution" as const : undefined;
  return {
    unavailable, rejectedParameter, allowed,
    authentication: details?.status === 401 || details?.status === 403,
    // Explicit flags are meaningful only on a terminal error response.
    free: nested.charged === false || nested.billed === false || nested.no_charge === true || row.charged === false || row.billed === false,
    definiteReason: details?.status === 401 || details?.status === 403 ? "鉴权失败，请检查当前分组 Key" : details?.status === 402 ? "账户余额不足" : undefined,
    terminal: details?.status !== undefined && details.status !== 408 && details.status !== 504,
  };
}
