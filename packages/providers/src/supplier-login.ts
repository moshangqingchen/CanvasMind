import {
  createCipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  constants,
} from "node:crypto";
import { fetchProviderJson, providerFetch, ProviderHttpError } from "./http.js";
import type { FetchImplementation } from "./contracts.js";
import { isWeAiLegacyAuthenticatedRead } from "./weai-legacy-catalog.js";
import {
  supplierDirectoryBase,
  type SupplierSiteKind,
} from "./supplier-catalog.js";

export interface SupplierSitePasswordCredentials {
  username: string;
  password: string;
}
export interface SupplierSiteTokenCredentials {
  accessToken: string;
  /** Older NewAPI installations require the account's numeric user ID. */
  userId?: string;
}
export type SupplierSiteCredentials = SupplierSitePasswordCredentials | SupplierSiteTokenCredentials;
export type SupplierLoginErrorCode =
  | "invalid_credentials"
  | "invalid_token"
  | "permission_denied"
  | "user_id_required"
  | "verification_required"
  | "unsupported_platform"
  | "invalid_configuration"
  | "rate_limited"
  | "network";
export class SupplierLoginError extends Error {
  constructor(
    message: string,
    readonly status = 401,
    readonly code: SupplierLoginErrorCode = status === 429
      ? "rate_limited" : status >= 500 ? "network" : "invalid_credentials",
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "network";
  }
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const normalizedUserId = (value: unknown): string | undefined => {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value)
    : typeof value === "string" ? value.trim() : "";
  if (!/^[1-9]\d{0,18}$/u.test(text) || BigInt(text) > 9223372036854775807n) return undefined;
  return text;
};

function tokenLoginFailure(status: number | undefined, payload: unknown, kind: "newapi" | "sub2api", userId?: string): SupplierLoginError {
  // Remote messages are classification evidence only. Never echo their contents.
  const root = record(payload);
  const nested = record(root?.error);
  const evidence = [root?.code, root?.message, nested?.code, nested?.message]
    .filter(value => typeof value === "string").join(" ");
  if (kind === "newapi" && /New[-_]Api[-_]User/iu.test(evidence)) {
    if (!userId && /未提供|缺少|missing|required|not provided/iu.test(evidence))
      return new SupplierLoginError("该站点需要用户 ID，请填写后台账号对应的用户 ID 后重试", 400, "user_id_required");
    return new SupplierLoginError("用户 ID 与访问令牌对应账号不一致或格式不正确，请检查后台用户 ID", 400, "invalid_configuration");
  }
  if (status === 429) return new SupplierLoginError("站点限制了验证频率，请稍后重试", 429);
  if (status === 403 || /AUTH_INSUFFICIENT_PRIVILEGE|ACCESS_TOKEN_SCOPE_DENIED|权限不足|insufficient privilege|permission denied/iu.test(evidence))
    return new SupplierLoginError("访问令牌权限不足，无法读取后台账号信息，请在站点检查令牌权限", 403, "permission_denied");
  if ((status ?? 0) >= 500 || !status)
    return new SupplierLoginError("站点访问令牌验证请求失败，请检查地址或稍后重试", 502);
  if (status === 404 || status === 405)
    return new SupplierLoginError("站点不支持当前平台的账号验证接口，请检查平台类型和站点地址", 400, "unsupported_platform");
  return new SupplierLoginError("访问令牌无效、已过期或已撤销，请在站点后台获取新的访问令牌", 401, "invalid_token");
}

/** Create a request-local website session. No cookie/token is exposed to the client. */
export async function loginSupplierSite(
  input: {
    siteUrl: string;
    kind: SupplierSiteKind;
    credentials: SupplierSiteCredentials;
  },
  fetchImpl: FetchImplementation = providerFetch,
): Promise<{ kind: "newapi" | "sub2api"; fetch: FetchImplementation }> {
  const base = supplierDirectoryBase(input.siteUrl);
  const tokenCredentials = "accessToken" in input.credentials ? input.credentials : undefined;
  const passwordCredentials = "username" in input.credentials ? input.credentials : undefined;
  if (!base) throw new SupplierLoginError("请填写有效的站点地址", 400, "invalid_configuration");
  if (tokenCredentials && passwordCredentials)
    throw new SupplierLoginError("请选择账号密码或访问令牌其中一种登录方式", 400, "invalid_configuration");
  const accessToken = tokenCredentials?.accessToken.trim().replace(/^Bearer(?:\s+|$)/iu, "");
  const suppliedUserId = tokenCredentials?.userId === undefined ? undefined : normalizedUserId(tokenCredentials.userId);
  if (tokenCredentials && (!accessToken || accessToken.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(accessToken)))
    throw new SupplierLoginError("请填写有效的后台访问令牌", 400, "invalid_configuration");
  if (tokenCredentials?.userId !== undefined && !suppliedUserId)
    throw new SupplierLoginError("用户 ID 必须是后台账号对应的正整数", 400, "invalid_configuration");
  if (!tokenCredentials && (!passwordCredentials?.username.trim() || !passwordCredentials.password))
    throw new SupplierLoginError("请填写站点账号和密码", 400, "invalid_configuration");
  const read = (path: string, fetcher = fetchImpl, init: RequestInit = {}) =>
    fetchProviderJson<unknown>(
      fetcher,
      `${base}${path}`,
      {
        method: "GET",
        cache: "no-store",
        ...init,
      },
      { phase: "connect", timeoutMs: 12000, maxResponseBytes: 1024 * 1024 },
    );
  let kind = input.kind;
  const detectionErrors: unknown[] = [];
  const detectionFailure = (error: unknown) => { detectionErrors.push(error); return null; };
  if (kind === "auto") {
    const status = record(await read("/api/status").catch(detectionFailure));
    const data = record(status?.data);
    if (
      data &&
      ["system_name", "HeaderNavModules", "quota_per_unit"].some(
        (key) => key in data,
      )
    )
      kind = "newapi";
    else {
      const setup = record(await read("/setup/status").catch(detectionFailure));
      if (record(setup?.data)?.needs_setup !== undefined) kind = "sub2api";
    }
  }
  if (kind !== "newapi" && kind !== "sub2api") {
    if (detectionErrors.some(error => error instanceof ProviderHttpError && error.details.status === 429))
      throw new SupplierLoginError("站点限制了读取频率，请稍后重试", 429);
    if (detectionErrors.length === 2 && detectionErrors.some(error =>
      !(error instanceof ProviderHttpError) ||
      ["network", "timeout"].includes(error.details.kind) || (error.details.status ?? 0) >= 500))
      throw new SupplierLoginError("站点暂时不可达，无法识别登录方式，请检查网络并稍后重试", 502);
    throw new SupplierLoginError(
      "无法识别站点登录方式，请在平台类型中选择 NewAPI 或 Sub2API",
      400,
      "unsupported_platform",
    );
  }

  if (tokenCredentials) {
    const headers = new Headers({ authorization: `Bearer ${accessToken}` });
    if (kind === "newapi" && suppliedUserId) headers.set("New-Api-User", suppliedUserId);
    let profile: unknown;
    try {
      profile = await read(kind === "newapi" ? "/api/user/self" : "/api/v1/user/profile", fetchImpl, { headers: new Headers(headers) });
    } catch (error) {
      throw tokenLoginFailure(error instanceof ProviderHttpError ? error.details.status : undefined,
        error instanceof ProviderHttpError ? error.details.responseBody : undefined, kind, suppliedUserId);
    }
    const root = record(profile);
    const data = record(root?.data) ?? root;
    if (!root || root.success === false ||
      (typeof root.code === "number" && root.code !== 0 && root.code !== 200) || root.error)
      throw tokenLoginFailure(200, profile, kind, suppliedUserId);
    const userId = normalizedUserId((record(data?.user) ?? data)?.id);
    if (!userId)
      throw new SupplierLoginError("站点未返回可验证的账号信息，请检查平台类型和后台访问令牌", 400, "invalid_configuration");
    if (kind === "newapi") {
      if (suppliedUserId && suppliedUserId !== userId)
        throw new SupplierLoginError("用户 ID 与访问令牌对应账号不一致，请检查后台用户 ID", 400, "invalid_configuration");
      headers.set("New-Api-User", userId);
    }
    return createSupplierSiteSession(base, kind, headers, fetchImpl);
  }
  // Token authentication returned above, leaving the legacy password contract.
  const credentials = passwordCredentials!;

  const cookies: string[] = [];
  const capture: FetchImplementation = async (url, init) => {
    const response = await fetchImpl(url, init);
    if (response.ok)
      cookies.push(
        ...response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";", 1)[0]!)
          .filter(Boolean),
      );
    return response;
  };
  let payload: unknown;
  try {
    let loginBody: Record<string, string> =
      kind === "newapi"
        ? {
            username: credentials.username.trim(),
            password: credentials.password,
          }
        : {
            email: credentials.username.trim(),
            password: credentials.password,
          };
    if (kind === "newapi") {
      // Older deployments lack this endpoint; newer ones can require RSA-OAEP.
      const encryption = record(
        await read("/api/user/login/encryption-key").catch((error) => {
          if (
            error instanceof ProviderHttpError &&
            [404, 405].includes(error.details.status ?? 0)
          )
            return null;
          throw error;
        }),
      );
      const keyInfo = record(encryption?.data);
      if (keyInfo?.enabled === true) {
        if (
          typeof keyInfo.public_key !== "string" ||
          typeof keyInfo.kid !== "string"
        )
          throw new Error("Invalid login encryption key");
        const key = createPublicKey(keyInfo.public_key);
        const plain = Buffer.from(credentials.password, "utf8");
        const rsaOptions = {
          key,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        };
        let encrypted: string;
        if (
          plain.length <=
          (key.asymmetricKeyDetails?.modulusLength ?? 2048) / 8 - 66
        ) {
          encrypted = publicEncrypt(rsaOptions, plain).toString("base64");
        } else {
          const secret = randomBytes(32);
          const nonce = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", secret, nonce);
          cipher.setAAD(Buffer.from(`password-v2:${keyInfo.kid}`));
          const ciphertext = Buffer.concat([
            cipher.update(plain),
            cipher.final(),
            cipher.getAuthTag(),
          ]);
          const wrapped = publicEncrypt(
            { ...rsaOptions, oaepLabel: Buffer.from("password-v2") },
            secret,
          );
          encrypted = `v2.${wrapped.toString("base64")}.${nonce.toString("base64")}.${ciphertext.toString("base64")}`;
        }
        loginBody = {
          username: credentials.username.trim(),
          password_encrypted: encrypted,
          encryption_key_id: keyInfo.kid,
        };
      }
    }
    payload = await read(
      kind === "newapi" ? "/api/user/login" : "/api/v1/auth/login",
      capture,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(loginBody),
      },
    );
  } catch (error) {
    const status =
      error instanceof ProviderHttpError ? error.details.status : undefined;
    if (status === 429)
      throw new SupplierLoginError("站点限制了登录频率，请稍后重试", 429);
    if (status === 403)
      throw new SupplierLoginError(
        "站点拒绝登录或要求验证码，请先在站点完成验证后重试",
        403,
        "verification_required",
      );
    if (status === 400 || status === 401)
      throw new SupplierLoginError("登录失败，请检查站点账号、密码及验证要求");
    throw new SupplierLoginError("站点登录请求失败，请检查地址或稍后重试", 502);
  }
  const root = record(payload);
  const data = record(root?.data) ?? root;
  if (
    data?.requires_2fa ||
    data?.require_2fa ||
    data?.need_2fa ||
    data?.challenge_id ||
    data?.verification_required
  )
    throw new SupplierLoginError(
      "站点要求二步验证，请先在站点完成验证；当前账号密码直连尚不能完成该验证",
      401,
      "verification_required",
    );
  if (
    !root ||
    root.success === false ||
    (typeof root.code === "number" && root.code !== 0 && root.code !== 200)
  )
    throw new SupplierLoginError("登录失败，请检查站点账号、密码及验证码要求");
  const token =
    typeof data?.access_token === "string" ? data.access_token : undefined;
  const user = record(data?.user) ?? data;
  const userId =
    typeof user?.id === "number" || typeof user?.id === "string"
      ? String(user.id)
      : undefined;
  if (kind === "sub2api" ? !token : !token && (!cookies.length || !userId))
    throw new SupplierLoginError(
      "站点未完成登录，可能需要验证码、二步验证或其他登录方式",
      401,
      "verification_required",
    );
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  else if (cookies.length) headers.set("cookie", cookies.join("; "));
  if (kind === "newapi" && userId) headers.set("New-Api-User", userId);
  return createSupplierSiteSession(base, kind, headers, fetchImpl);
}

function createSupplierSiteSession(base: string, kind: "newapi" | "sub2api", headers: Headers, fetchImpl: FetchImplementation): {
  kind: "newapi" | "sub2api"; fetch: FetchImplementation;
} {
  const allowedUrls = new Set(
    [
      "/api/pricing",
      "/api/user/self/groups",
      // Exact official account inventory, never a model API or another host.
      ...(base === "https://tk1688.com" && kind === "newapi" ? ["/api/user/models"] : []),
      "/api/v1/model-plaza",
      "/api/v1/groups/available",
      ...(base === "https://synoralink.com" && kind === "sub2api" ? ["/api/v1/announcements"] : []),
    ].map((path) => `${base}${path}`),
  );
  return {
    kind,
    fetch: async (url, init) => {
      const target =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      const method = (init?.method ?? (url instanceof Request ? url.method : "GET")).toUpperCase();
      let authenticatedTarget = false;
      try {
        const parsed = new URL(target);
        const endpoint = `${parsed.origin}${parsed.pathname}`;
        const paginationOnly = [...parsed.searchParams].every(([key, value]) =>
          ["p", "page", "page_size"].includes(key) && /^\d+$/u.test(value));
        const usageQuery = [...parsed.searchParams].every(([key, value]) =>
          ["p", "page", "page_size", "type"].includes(key) ? /^\d+$/u.test(value)
            : key === "request_id" && /^[A-Za-z0-9_-]{1,128}$/u.test(value));
        // The deployed Sub2API usage screen filters exact models and official
        // groups. Authenticate those reads without widening endpoints/methods.
        const scopedUsageQuery = [...parsed.searchParams].every(([key, value]) =>
          parsed.searchParams.getAll(key).length === 1 && (
            ["p", "page", "page_size", "type"].includes(key) ? /^\d+$/u.test(value)
              : key === "request_id" ? /^[A-Za-z0-9_-]{1,128}$/u.test(value)
              : key === "group_id" ? /^[1-9]\d*$/u.test(value)
              : key === "model" && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)));
        const statsParameters = ["type", "start_timestamp", "end_timestamp"];
        const selfStatsQuery = statsParameters.every(key => parsed.searchParams.getAll(key).length === 1) &&
          [...parsed.searchParams].every(([key, value]) => statsParameters.includes(key) && /^[1-9]\d*$/u.test(value));
        const accountRead = method === "GET" && (
          (kind === "newapi" && (
            (endpoint === `${base}/api/user/self` && !parsed.search) ||
            (endpoint === `${base}/api/log/self/stat` && selfStatsQuery) ||
            ([`${base}/api/log/self`, `${base}/api/log/self/`].includes(endpoint) && usageQuery))) ||
          (kind === "sub2api" && (
            (endpoint === `${base}/api/v1/user/profile` && !parsed.search) ||
            (endpoint === `${base}/api/v1/usage/dashboard/stats` && !parsed.search) ||
            (endpoint === `${base}/api/v1/usage` && (usageQuery || scopedUsageQuery))))
        );
        authenticatedTarget = !parsed.hash && !parsed.username && !parsed.password && (
          accountRead ||
          (kind === "sub2api" && isWeAiLegacyAuthenticatedRead(base, parsed, method)) ||
          (method === "GET" && allowedUrls.has(target)) ||
          (method === "GET" && paginationOnly && (
            (kind === "sub2api" && (endpoint === `${base}/api/v1/keys` ||
              new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/api/v1/keys/\\d+$`, "u").test(endpoint))) ||
            (kind === "newapi" && endpoint === `${base}/api/token/`)
          )) ||
          (kind === "newapi" && method === "POST" && !parsed.search &&
            new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/api/token/\\d+/key$`, "u").test(endpoint))
        );
      } catch { /* Unknown URLs never receive website credentials. */ }
      if (!authenticatedTarget) return fetchImpl(url, init);
      const authenticated = new Headers(init?.headers);
      headers.forEach((value, key) => authenticated.set(key, value));
      return fetchImpl(url, { ...init, headers: authenticated, redirect: "error" });
    },
  };
}
