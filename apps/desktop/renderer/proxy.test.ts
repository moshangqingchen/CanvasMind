import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
const origin = "http://127.0.0.1:4312";
const token = "desktop-test-session";
describe("desktop renderer boundary", () => {
  beforeEach(() => { vi.stubEnv("SUPERCANVAS_DESKTOP", "true"); vi.stubEnv("SUPERCANVAS_DESKTOP_ORIGIN", origin); vi.stubEnv("SUPERCANVAS_DESKTOP_TOKEN", token); });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["/", "/api/health", "/api/canvas", "/_next/static/app.js"])("rejects browser access to %s without an Electron session", path => {
    expect(proxy(new NextRequest(origin + path)).status).toBe(401);
  });
  it("never falls back to an unauthenticated website", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "false");
    expect(proxy(new NextRequest(origin, { headers: { "x-supercanvas-desktop-token": token } })).status).toBe(401);
  });
  it("accepts the desktop session with the same origin", () => {
    const response = proxy(new NextRequest(origin + "/api/canvas", { headers: { "x-supercanvas-desktop-token": token, origin } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
  it("rejects other origins and public hosts even with a session token", () => {
    expect(proxy(new NextRequest(origin, { headers: { "x-supercanvas-desktop-token": token, origin: "https://other.example" } })).status).toBe(403);
    expect(proxy(new NextRequest("https://public.example/api/canvas", { headers: { "x-supercanvas-desktop-token": token } })).status).toBe(403);
  });
});
