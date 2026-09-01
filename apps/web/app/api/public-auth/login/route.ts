import { NextResponse } from "next/server";
import {
  checkLoginAllowed,
  clientKey,
  recordLoginFailure,
  recordLoginSuccess,
} from "../../../../lib/login-rate-limit";
import {
  credentialsMatch,
  getPublicAuthConfig,
  PUBLIC_AUTH_COOKIE,
} from "../../../../lib/public-auth";

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Credentials longer than this are rejected before any comparison work. */
const MAX_CREDENTIAL_LENGTH = 512;

export async function POST(request: Request) {
  const key = clientKey(request);
  const verdict = checkLoginAllowed(key);
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: `尝试次数过多，请在 ${Math.ceil(verdict.retryAfterSeconds / 60)} 分钟后重试`,
      },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(verdict.retryAfterSeconds),
        },
      },
    );
  }

  let body: LoginBody;

  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "请求格式不正确" },
      { status: 400, headers: NO_STORE },
    );
  }

  const config = getPublicAuthConfig();
  if (!config.username || !config.password || !config.sessionToken) {
    return NextResponse.json(
      { ok: false, message: "登录服务尚未配置" },
      { status: 503, headers: NO_STORE },
    );
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  const authenticated =
    username.length <= MAX_CREDENTIAL_LENGTH &&
    password.length <= MAX_CREDENTIAL_LENGTH &&
    credentialsMatch(
      { username, password },
      { username: config.username, password: config.password },
    );

  if (!authenticated) {
    recordLoginFailure(key);
    return NextResponse.json(
      { ok: false, message: "用户名或密码不正确" },
      { status: 401, headers: NO_STORE },
    );
  }

  recordLoginSuccess(key);
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const requestProtocol = new URL(request.url).protocol;
  const isSecureRequest =
    forwardedProto === "https" || requestProtocol === "https:";
  response.cookies.set(PUBLIC_AUTH_COOKIE, config.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && isSecureRequest,
    // "lax" keeps inbound links working; cross-site writes are blocked by the
    // Origin check in proxy.ts rather than by the cookie policy alone.
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
