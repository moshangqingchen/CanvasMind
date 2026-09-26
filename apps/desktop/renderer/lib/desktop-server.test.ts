import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { desktopAuthorized, desktopLifecycleState } from "./desktop-server";
import { proxy } from "../proxy";
afterEach(() => { vi.unstubAllEnvs(); delete globalThis.__superCanvasDesktopLifecycle; });
describe("desktop isolation", () => {
  it("requires desktop mode and an exact per-launch token", () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP_TOKEN", "random-session-token");
    const request = new Request("http://127.0.0.1:4567/api/health", { headers: { "x-supercanvas-desktop-token": "random-session-token" } });
    expect(desktopAuthorized(request)).toBe(false);
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    vi.stubEnv("SUPERCANVAS_DESKTOP_ORIGIN", "http://127.0.0.1:4567");
    expect(desktopAuthorized(request)).toBe(true);
    expect(desktopAuthorized(new Request(request.url))).toBe(false);
    expect(proxy(new NextRequest(request.url)).status).toBe(401);
    expect(proxy(new NextRequest(request.url, { headers: { "x-supercanvas-desktop-token": "random-session-token", origin: "https://unrelated.example" } })).status).toBe(403);
    expect(proxy(new NextRequest(request.url, { headers: request.headers })).headers.get("x-middleware-next")).toBe("1");
  });
  it("fails closed when the runtime request monitor was not loaded", () => {
    expect(() => desktopLifecycleState()).toThrow(/不能安全退出/);
    globalThis.__superCanvasDesktopLifecycle = { draining: true, writes: 2 };
    expect(desktopLifecycleState()).toEqual({ draining: true, writes: 2 });
  });
});
