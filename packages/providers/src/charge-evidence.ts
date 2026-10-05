export interface ProviderChargeEvidence {
  status: "charged" | "not_charged" | "refunded" | "unknown";
  amount?: number;
  currency?: string;
  source: "provider_response" | "not_submitted" | "unconfirmed";
}

const unconfirmed = (): ProviderChargeEvidence => ({ status: "unknown", source: "unconfirmed" });

function amount(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value.trim()))) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER ? parsed : undefined;
}

function currency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = value.trim();
  if (/^[a-z]{3}$/iu.test(parsed) || /^(?:credits?|points?|tokens?|quota)$/iu.test(parsed)) return parsed.toUpperCase();
  return ["元", "人民币", "积分", "点数", "额度"].includes(parsed) ? parsed : undefined;
}

interface CurrencyEvidence { value?: string; conflict?: true }

function currencyEvidence(values: unknown[], inherited?: CurrencyEvidence): CurrencyEvidence {
  const units = new Set(values.flatMap(value => { const parsed = currency(value); return parsed ? [parsed] : []; }));
  if (units.size > 1) return { conflict: true };
  return units.size === 1 ? { value: [...units][0]! } : inherited ?? {};
}

function flag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function status(value: unknown): ProviderChargeEvidence["status"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[ -]/gu, "_");
  if (["charged", "billed", "paid"].includes(normalized)) return "charged";
  if (["not_charged", "no_charge", "unbilled", "free"].includes(normalized)) return "not_charged";
  if (["refunded", "refund_completed"].includes(normalized)) return "refunded";
  return undefined;
}

/** Read single-request billing facts, never prices, balances or inferred deltas. */
export function extractProviderChargeEvidence(value: unknown): ProviderChargeEvidence {
  const evidence: (ProviderChargeEvidence & { currencyConflict?: true })[] = [];
  const seen = new Set<object>();
  let invalidAmount = false;
  let unconfirmedRefund = false;
  const visit = (input: unknown, depth: number, container?: "charge" | "refund" | "billing", inheritedCurrency?: CurrencyEvidence, allowRefund = true, inheritedRefundCurrency?: CurrencyEvidence): void => {
    if (depth > 6 || seen.size >= 64) return;
    if (typeof input === "string" && input.length <= 65_536 && /^\s*\{/u.test(input)) {
      try { input = JSON.parse(input) as unknown; } catch { return; }
    }
    if (!input || typeof input !== "object" || Array.isArray(input) || seen.has(input)) return;
    seen.add(input);
    const record = input as Record<string, unknown>;
    const declaredStatuses = [record.charge_status, record.chargeStatus, record.billing_status, record.billingStatus, ...(container ? [record.status] : [])]
      .filter(value => value !== undefined && value !== null);
    // Every receipt path, including aliases and nested receipts, must pass the
    // same confirmation gate. Pending/refunded estimates are not transactions.
    const estimated = [record.estimated, record.approximate, record.is_estimate, record.isEstimate, record.is_estimated, record.isEstimated]
      .some(value => flag(value) === true || value === 1 || value === "1");
    const refundStatuses = [record.refund_status, record.refundStatus].filter(value => value !== undefined && value !== null);
    // A contradictory refund detail must also invalidate a completed summary
    // elsewhere in this request, while retaining any original charge evidence.
    if (flag(record.refunded) === false || refundStatuses.some(value => status(value) !== "refunded") ||
      (container === "refund" && (estimated || declaredStatuses.some(value => status(value) !== "refunded")))) unconfirmedRefund = true;
    if (estimated || declaredStatuses.some(value => status(value) === undefined)) return;
    const refundConfirmed = allowRefund && flag(record.refunded) !== false && refundStatuses.every(value => status(value) === "refunded");
    if (!refundConfirmed && (container === "refund" || declaredStatuses.some(value => status(value) === "refunded"))) return;
    // A receipt inside `refund` must describe a refund, not an original charge
    // or a free request. Its generic amount alone cannot confirm money returned.
    if (container === "refund" && declaredStatuses.some(value => status(value) !== "refunded")) return;
    const readAmount = (key: string): number | undefined => {
      const parsed = amount(record[key]);
      if (record[key] !== undefined && record[key] !== null && parsed === undefined) invalidAmount = true;
      return parsed;
    };
    const unit = currencyEvidence([record.currency, record.charge_currency, record.unit], inheritedCurrency);
    // Refund-specific units take precedence over the original charge's unit,
    // but aliases describing the same receipt must agree with one another.
    const refundUnit = currencyEvidence([record.refund_currency, record.refundCurrency],
      currencyEvidence([record.currency, record.unit], inheritedRefundCurrency ?? unit));
    const add = (kind: ProviderChargeEvidence["status"], paid?: number): void => {
      const receiptUnit = kind === "refunded" ? refundUnit : unit;
      evidence.push({ status: kind, source: "provider_response", ...(paid === undefined ? {} : { amount: paid }),
        ...(receiptUnit.value ? { currency: receiptUnit.value } : {}), ...(receiptUnit.conflict ? { currencyConflict: true } : {}) });
    };
    const statuses = [...declaredStatuses, ...(refundConfirmed ? refundStatuses : [])]
      .flatMap(value => { const parsed = status(value); return parsed ? [parsed] : []; });
    let explicitStatus = statuses[0];
    if (refundConfirmed && flag(record.refunded) === true) explicitStatus = "refunded";
    const chargeFlag = flag(record.charged) ?? flag(record.billed);
    const freeFlag = [record.no_charge, record.noCharge, record.not_charged].some(value => flag(value) === true);
    for (const declared of statuses) add(declared);
    if (refundConfirmed && flag(record.refunded) === true) add("refunded");
    for (const value of [record.charged, record.billed]) {
      const charged = flag(value);
      if (charged !== undefined) add(charged ? "charged" : "not_charged");
    }
    if (freeFlag === true) add("not_charged");
    for (const key of ["charged_amount", "chargedAmount", "amount_charged", "billed_amount", "billedAmount"]) {
      const paid = readAmount(key);
      if (paid !== undefined) add(paid === 0 ? "not_charged" : "charged", paid);
    }
    for (const key of refundConfirmed ? ["refunded_amount", "refundedAmount", "refund_amount", "refundAmount"] : []) {
      const refunded = readAmount(key);
      if (refunded !== undefined && (refunded > 0 || explicitStatus === "refunded")) add("refunded", refunded);
    }
    const confirmedAmountContext = container === "refund" ? explicitStatus === "refunded" : container === "charge" || explicitStatus || chargeFlag !== undefined || freeFlag === true;
    const paid = confirmedAmountContext ? readAmount("amount") : undefined;
    if (paid !== undefined) {
      if (explicitStatus === "refunded") add("refunded", paid);
      else add(paid === 0 ? "not_charged" : "charged", paid);
    }
    if (container === "charge" || container === "billing" || explicitStatus || chargeFlag !== undefined) {
      for (const key of ["actual_cost", "actualCost", ...(container === "charge" || container === "billing" ? ["cost"] : [])]) {
        const actual = readAmount(key);
        if (actual !== undefined) add(explicitStatus === "refunded" ? "refunded" : actual === 0 ? "not_charged" : "charged", actual);
      }
    }
    const directCharge = typeof record.charge === "object" ? undefined : readAmount("charge");
    if (directCharge !== undefined) add(directCharge === 0 ? "not_charged" : "charged", directCharge);
    for (const key of ["remote", "error", "data", "result", "task", "details", "response", "usage"]) visit(record[key], depth + 1, undefined, unit, refundConfirmed, refundUnit);
    for (const key of ["charge", "refund", "billing"] as const) visit(record[key], depth + 1, key, key === "refund" ? refundUnit : unit, refundConfirmed, refundUnit);
  };
  visit(value, 0);
  if (!evidence.length || invalidAmount) return unconfirmed();
  // A confirmed refund supersedes the original charge. Other contradictory
  // receipts remain unconfirmed instead of choosing a reassuring answer.
  const confirmed = unconfirmedRefund ? evidence.filter(entry => entry.status !== "refunded") : evidence;
  if (!confirmed.length) return unconfirmed();
  const refunded = confirmed.filter(entry => entry.status === "refunded");
  const candidates = refunded.length ? refunded : confirmed;
  const statuses = new Set(candidates.map(entry => entry.status));
  if (statuses.size !== 1) return unconfirmed();
  const amounts = new Set(candidates.flatMap(entry => entry.amount === undefined ? [] : [entry.amount]));
  const currencies = new Set(candidates.flatMap(entry => entry.currency ? [entry.currency] : []));
  const currencyConflict = candidates.some(entry => entry.currencyConflict);
  return {
    status: candidates[0]!.status,
    source: "provider_response",
    ...(!currencyConflict && amounts.size === 1 && currencies.size <= 1 ? { amount: [...amounts][0]! } : {}),
    ...(!currencyConflict && currencies.size === 1 ? { currency: [...currencies][0]! } : {}),
  };
}
