import { NextResponse } from "next/server";
import {
  constantTimeEqual,
  getPublicAuthConfig,
  PUBLIC_AUTH_COOKIE,
} from "../../../../lib/public-auth";

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let body: LoginBody;

  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "请求格式不正确" },
      { status: 400 },
    );
  }

  const config = getPublicAuthConfig();
  if (!config.username || !config.password || !config.sessionToken) {
    return NextResponse.json(
      { ok: false, message: "登录服务尚未配置" },
      { status: 503 },
    );
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const authenticated =
    constantTimeEqual(username, config.username) &&
    constantTimeEqual(password, config.password);

  if (!authenticated) {
    return NextResponse.json(
      { ok: false, message: "用户名或密码不正确" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(PUBLIC_AUTH_COOKIE, config.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
