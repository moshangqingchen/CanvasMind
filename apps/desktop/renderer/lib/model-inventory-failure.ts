import { ProviderHttpError } from "@super-canvas/providers";

const messages = {
  invalid_credentials: "当前 Key 鉴权失败，请更新 Key 后重新刷新；原有配置已保留",
  permission_denied: "当前 Key 无权读取模型目录，请检查分组权限；原有配置已保留",
  insufficient_balance: "供应商账户余额不足，暂时无法读取模型目录，请补充余额后重新刷新；原有配置已保留",
  rate_limited: "模型目录读取被限流，请稍后重试；原有配置已保留",
  timeout: "模型目录读取超时，请检查网络后重试；原有配置已保留",
  network: "模型目录暂不可读取，请检查网络后重试；原有配置已保留",
  invalid_response: "模型目录返回格式无效，本次不能确认模型新增或删除；原有配置已保留",
  incomplete_directory: "模型目录未完整返回，本次不能确认模型删除；原有配置已保留",
  directory_unavailable: "模型目录服务暂不可用，请稍后重试；原有配置已保留",
  invalid_configuration: "当前连接未配置可用的模型目录接口；原有配置已保留",
} as const;
type FailureCode = keyof typeof messages;
export type ModelInventoryFailure = { code: FailureCode; message: string; httpStatus?: number };

/** Never retain upstream bodies, exception messages, credentials or request URLs. */
export class ModelInventoryReadError extends Error {
  constructor(readonly code: FailureCode, readonly httpStatus?: number) { super(messages[code]); }
}
const validHttpStatus = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
const knownCode = (value: string | null): value is FailureCode => Boolean(value && Object.hasOwn(messages, value));
const strictBoolean = (value: unknown): boolean | undefined =>
  value === true || value === "true" || value === 1 || value === "1" ? true
    : value === false || value === "false" || value === 0 || value === "0" ? false : undefined;
const strictCount = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
};

function balanceError(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const root = payload as Record<string, unknown>;
  const nested = root.error && typeof root.error === "object" && !Array.isArray(root.error) ? root.error as Record<string, unknown> : {};
  return [root.code, root.error, nested.code].some(value => typeof value === "string" && value.toUpperCase() === "INSUFFICIENT_BALANCE");
}

export function modelInventoryFailure(error?: unknown, response?: Response): ModelInventoryFailure {
  const headerCode = response?.headers.get("X-Model-Scan-Error-Code") ?? null;
  const suppliedHttp = response?.headers.get("X-Model-Scan-Http-Status");
  const status = error instanceof ModelInventoryReadError ? error.httpStatus
    : error instanceof ProviderHttpError ? error.details.status
      : knownCode(headerCode) ? suppliedHttp ? Number(suppliedHttp) : undefined
        : response && (response.status >= 400 || response.headers.get("X-Model-Scan-Status") === "unauthorized") ? response.status : undefined;
  const code: FailureCode = error instanceof ModelInventoryReadError ? error.code
    : knownCode(headerCode) ? headerCode
      : error instanceof ProviderHttpError && balanceError(error.details.responseBody) ? "insufficient_balance"
      : status === 401 ? "invalid_credentials"
        : status === 403 || response?.headers.get("X-Model-Scan-Status") === "unauthorized" ? "permission_denied"
          : status === 429 ? "rate_limited"
            : error instanceof ProviderHttpError && error.details.kind === "timeout" ? "timeout"
              : error instanceof ProviderHttpError && error.details.kind === "invalid_response" ? "invalid_response"
                : response?.headers.get("X-Model-Scan-Status") === "unconfigured" ? "invalid_configuration"
                  : status && status >= 500 ? "directory_unavailable" : "network";
  return { code, message: messages[code], ...(validHttpStatus(status) ? { httpStatus: status } : {}) };
}

export function modelInventoryFailureHeaders(failure: ModelInventoryFailure): Record<string, string> {
  return { "X-Model-Scan-Error-Code": failure.code,
    ...(failure.httpStatus ? { "X-Model-Scan-Http-Status": String(failure.httpStatus) } : {}) };
}

export function modelInventoryFailureConfig(failure: ModelInventoryFailure) {
  return { modelScanComplete: false, modelScanError: failure.message, modelScanErrorCode: failure.code,
    modelScanHttpStatus: failure.httpStatus ?? null };
}

/** Saved/manual fallbacks and even 200 unauthorized responses cannot establish removals. */
export function isCompleteModelInventoryResponse(response: Response, payload: unknown): boolean {
  const status = response.headers.get("X-Model-Scan-Status");
  return response.ok && Array.isArray(payload) && (status === null || status === "live" || status === "empty") &&
    response.headers.get("X-Model-Scan-Complete") !== "false" &&
    !["saved", "snapshot", "manual"].includes(response.headers.get("X-Model-Scan-Source") ?? "");
}

/** A 200 error page, malformed list or unfinished pagination is never an empty directory. */
export function assertCompleteModelInventoryPayload(payload: unknown): void {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const suppliedCode = root?.code;
  const successfulCode = suppliedCode === undefined || suppliedCode === null || suppliedCode === 0 || suppliedCode === 200 ||
    suppliedCode === "0" || suppliedCode === "200" || typeof suppliedCode === "string" && ["ok", "success"].includes(suppliedCode.toLowerCase());
  if (strictBoolean(root?.success) === false || root?.error || !successfulCode) {
    if (!root) throw new ModelInventoryReadError("invalid_response", 200);
    const nested = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
    const rawCode = root.code ?? nested.code;
    const code = strictCount(rawCode) ?? rawCode;
    throw new ModelInventoryReadError(balanceError(root) ? "insufficient_balance"
      : code === 401 || code === "invalid_api_key" ? "invalid_credentials"
      : code === 403 || code === "permission_denied" ? "permission_denied" : "invalid_response", 200);
  }
  const collections = Array.isArray(payload) ? [payload] : root
    ? ["data", "models", "items", "result"].filter(key => root[key] !== undefined && root[key] !== null).map(key => root[key]) : [];
  if (!collections.length || collections.some(value => typeof value !== "object" || value === null))
    throw new ModelInventoryReadError("invalid_response", 200);
  const entries: unknown[] = collections.flatMap(value => Array.isArray(value) ? value
    : Object.entries(value as Record<string, unknown>).map(([id, model]) =>
      model && typeof model === "object" && !Array.isArray(model) ? { id, ...model } : null));
  const modelIds = entries.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entry = value as Record<string, unknown>;
    const id = entry.id ?? entry.model_name ?? entry.model ?? entry.name;
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
  });
  if (modelIds.some(id => !id)) throw new ModelInventoryReadError("invalid_response", 200);
  const modelCount = new Set(modelIds).size;
  const scopes = [root, root?.pagination, root?.meta].filter((value): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value)));
  if (scopes.some(value => ["complete", "has_more", "hasMore"].some(key =>
    value[key] !== undefined && value[key] !== null && strictBoolean(value[key]) === undefined) ||
    value.total !== undefined && value.total !== null && strictCount(value.total) === undefined))
    throw new ModelInventoryReadError("invalid_response", 200);
  if (scopes.some(value => strictBoolean(value.complete) === false || strictBoolean(value.has_more) === true || strictBoolean(value.hasMore) === true ||
    ["nextPageToken", "next_page_token", "nextCursor", "next_cursor", "next"].some(key =>
      typeof value[key] === "string" && value[key].trim()) ||
    (strictCount(value.total) ?? 0) > modelCount))
    throw new ModelInventoryReadError("incomplete_directory", 200);
}
