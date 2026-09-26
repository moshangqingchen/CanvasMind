import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderConnectionTestError, testConnection, testConnectionDetails } from "./client-api";

afterEach(() => vi.unstubAllGlobals());
describe("structured connection tests", () => {
  it.each([401, 403, 429, 503])("preserves HTTP %s and scan status without losing the safe message", async httpStatus => {
    const scanStatus = httpStatus === 401 || httpStatus === 403 ? "unauthorized" : "failed";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "请检查连接" }, {
      status: httpStatus, headers: { "X-Model-Scan-Status": scanStatus },
    })));
    const failure = await testConnectionDetails("denied").catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toBeInstanceOf(ProviderConnectionTestError);
    expect(failure).toMatchObject({ httpStatus, scanStatus, message: "请检查连接" });
  });
  it("returns reusable models and status with one request", async () => {
    const result = { message: "目录已更新", models: [{ id: "model", name: "Model", operations: [] }], status: "live",
      checkedAt: "2026-09-22T00:00:00Z", lastSuccessAt: "2026-09-22T00:00:00Z", source: "live" };
    const fetcher = vi.fn().mockResolvedValue(Response.json(result));
    vi.stubGlobal("fetch", fetcher);
    expect(await testConnectionDetails("group")).toEqual(result);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("preserves the string result for existing callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "目录为空", models: [], status: "empty" })));
    expect(await testConnection("legacy-caller")).toBe("目录为空");
  });
  it("does not turn cached or invalid responses into success", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ message: "old", models: [], status: "stale" }))
      .mockResolvedValueOnce(Response.json({ message: "missing models" })));
    await expect(testConnectionDetails("bad")).rejects.toThrow("未完成");
    await expect(testConnectionDetails("bad")).rejects.toThrow("无效模型列表");
  });
});
