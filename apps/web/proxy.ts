import { type NextRequest, NextResponse } from "next/server";
import {
  constantTimeEqual,
  getPublicAuthConfig,
  PUBLIC_AUTH_COOKIE,
} from "./lib/public-auth";

const PUBLIC_PATH_PREFIXES = ["/_next/", "/api/public-auth/", "/api/webhooks/"];

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/favicon.ico" ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export function proxy(request: NextRequest) {
  const config = getPublicAuthConfig();
  const requestHost = (request.headers.get("host") ?? "")
    .split(":", 1)[0]
    .toLowerCase();

  // Local development remains available without a login prompt.
  if (
    !config.username ||
    !config.password ||
    !config.sessionToken ||
    requestHost !== config.host ||
    isPublicPath(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(PUBLIC_AUTH_COOKIE)?.value ?? "";
  if (constantTimeEqual(sessionCookie, config.sessionToken)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "AUTH_REQUIRED",
          message: "请先登录超级画布",
        },
      },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: "/:path*",
};
