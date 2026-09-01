import { type NextRequest, NextResponse } from "next/server";
import {
  constantTimeEqual,
  getPublicAuthConfig,
  isLoopbackHost,
  isTrustedHost,
  normalizeHostHeader,
  PUBLIC_AUTH_COOKIE,
} from "./lib/public-auth";

const PUBLIC_PATH_PREFIXES = [
  "/_next/",
  "/api/public-auth/",
  "/api/provider-assets/",
  "/api/webhooks/",
];
/** Provider callbacks carry no Origin and authenticate with their own HMAC. */
const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/favicon.ico" ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function applySecurityHeaders(response: NextResponse) {
  const headers = response.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
}

function authRequired() {
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

const LOCAL_ASSET_BRIDGE_PATHS = new Set([
  "/api/assets/presign",
  "/api/assets/upload",
  "/api/assets/import-source",
]);

function isAllowedLocalAssetBridge(
  request: NextRequest,
  host: string,
  origin: string,
): boolean {
  if (!LOCAL_ASSET_BRIDGE_PATHS.has(request.nextUrl.pathname)) return false;
  if (!isLoopbackHost(host)) return false;
  try {
    const publicOrigin = process.env.PUBLIC_BASE_URL
      ? new URL(process.env.PUBLIC_BASE_URL).origin
      : "";
    return Boolean(publicOrigin && new URL(origin).origin === publicOrigin);
  } catch {
    return false;
  }
}

/**
 * Rejects cross-site state-changing calls that would otherwise ride the session
 * cookie. Requests without an Origin header (curl, provider callbacks, tests)
 * are allowed through: browsers always send Origin on cross-origin writes, so
 * "present but mismatched" is the case worth blocking.
 */
function isCrossSiteWrite(request: NextRequest, host: string): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/")) return false;
  if (CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix)))
    return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (isAllowedLocalAssetBridge(request, host, origin)) return false;
  try {
    return normalizeHostHeader(new URL(origin).host) !== host;
  } catch {
    return true;
  }
}

export function proxy(request: NextRequest) {
  const config = getPublicAuthConfig();
  const configured = Boolean(
    config.username && config.password && config.sessionToken,
  );
  const host = normalizeHostHeader(request.headers.get("host"));

  if (!configured) {
    // No credentials configured: the app runs unauthenticated, as documented.
    return applySecurityHeaders(NextResponse.next());
  }

  if (isCrossSiteWrite(request, host)) {
    return applySecurityHeaders(
      NextResponse.json(
        {
          ok: false,
          error: {
            type: "CROSS_ORIGIN_BLOCKED",
            message: "跨站请求已被拒绝",
          },
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  // Loopback (and any explicitly trusted host) keeps the no-login dev flow.
  if (isTrustedHost(host, config) || isPublicPath(request.nextUrl.pathname)) {
    return applySecurityHeaders(NextResponse.next());
  }

  const sessionCookie = request.cookies.get(PUBLIC_AUTH_COOKIE)?.value ?? "";
  if (constantTimeEqual(sessionCookie, config.sessionToken)) {
    return applySecurityHeaders(NextResponse.next());
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return applySecurityHeaders(authRequired());
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return applySecurityHeaders(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: "/:path*",
};
