import { type NextRequest, NextResponse } from "next/server";
import { desktopAuthorized } from "./lib/desktop-server";

export function proxy(request: NextRequest) {
  if (!desktopAuthorized(request)) return new NextResponse(null, { status: 401 });
  const origin = process.env.SUPERCANVAS_DESKTOP_ORIGIN;
  // Next normalizes 127.0.0.1 to localhost in its internal URL representation.
  const requestHost = request.headers.get("host") ?? new URL(request.url).host;
  const expected = origin ? new URL(origin) : null;
  const matchesHost = expected && [expected.host, `localhost:${expected.port}`].includes(requestHost);
  if (!origin || !matchesHost || (request.headers.get("origin") && request.headers.get("origin") !== origin))
    return new NextResponse(null, { status: 403 });
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
}
export const config = { matcher: "/:path*" };
