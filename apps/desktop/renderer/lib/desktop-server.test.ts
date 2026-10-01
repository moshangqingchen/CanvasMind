import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { desktopAuthorized, desktopLifecycleState, trackDesktopBackgroundWrite } from "./desktop-server";
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
  it("keeps delayed background work counted until its cleanup completes", async () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    const state = { draining: true, writes: 2 };
    globalThis.__superCanvasDesktopLifecycle = state;
    let complete!: () => void;
    let cleanUp!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const cleanup = new Promise<void>(resolve => { cleanUp = resolve; });
    const task = trackDesktopBackgroundWrite(() => pending.finally(() => cleanup));
    expect(state.writes).toBe(3);
    complete();
    await Promise.resolve();
    expect(state.writes).toBe(3);
    cleanUp();
    await task;
    await task;
    expect(state).toEqual({ draining: true, writes: 2 });
  });
  it("releases failed background work after its error handling", async () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    const state = { draining: false, writes: 1 };
    globalThis.__superCanvasDesktopLifecycle = state;
    let fail!: (error: Error) => void;
    let handled!: () => void;
    const pending = new Promise<void>((_, reject) => { fail = reject; });
    const handling = new Promise<void>(resolve => { handled = resolve; });
    const task = trackDesktopBackgroundWrite(() => pending.catch(async error => {
      await handling;
      throw error;
    }));
    const rejection = expect(task).rejects.toThrow("producer failed");
    fail(new Error("producer failed"));
    await Promise.resolve();
    expect(state.writes).toBe(2);
    handled();
    await rejection;
    expect(state.writes).toBe(1);
  });
  it("does not change lifecycle counts outside desktop mode or without the hook", async () => {
    vi.stubEnv("SUPERCANVAS_DESKTOP", "false");
    const state = { draining: true, writes: 4 };
    globalThis.__superCanvasDesktopLifecycle = state;
    const work = vi.fn(async () => { expect(state.writes).toBe(4); });
    await trackDesktopBackgroundWrite(work);
    expect(state.writes).toBe(4);
    expect(work).toHaveBeenCalledOnce();
    vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
    delete globalThis.__superCanvasDesktopLifecycle;
    const withoutHook = vi.fn(async () => {});
    await trackDesktopBackgroundWrite(withoutHook);
    expect(withoutHook).toHaveBeenCalledOnce();
    expect(globalThis.__superCanvasDesktopLifecycle).toBeUndefined();
  });
});
