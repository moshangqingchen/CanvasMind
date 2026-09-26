import { timingSafeEqual } from "node:crypto";

export interface DesktopLifecycleState { draining: boolean; writes: number }
declare global { var __superCanvasDesktopLifecycle: DesktopLifecycleState | undefined }

export function desktopAuthorized(request: Request): boolean {
  if (process.env.SUPERCANVAS_DESKTOP !== "true") return false;
  const expected = Buffer.from(process.env.SUPERCANVAS_DESKTOP_TOKEN ?? "");
  const actual = Buffer.from(request.headers.get("x-supercanvas-desktop-token") ?? "");
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function desktopLifecycleState(): DesktopLifecycleState {
  if (!globalThis.__superCanvasDesktopLifecycle) {
    throw new Error("桌面生命周期监控未启动，不能安全退出");
  }
  return globalThis.__superCanvasDesktopLifecycle;
}
