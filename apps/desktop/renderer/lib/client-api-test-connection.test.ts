import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, getCachedModels, invalidateModelCache, ProviderConnectionTestError, testConnection, testConnectionDetails } from "./client-api";

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

  it.each([200, 401])("rejects an old HTTP %i connection test after configuration changes without clearing the fresh model cache", async status => {
    let finish!: (response: Response) => void;
    const currentModels = [{ id: "current-model", name: "Current", operations: [] }];
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(Response.json(currentModels)));
    const id = `changed-during-test-${status}`;
    const pending = testConnectionDetails(id);
    const checked = expect(pending).rejects.toMatchObject({ httpStatus: 409, message: "连接已改变，请重新测试" });
    invalidateModelCache(id);
    await fetchModels(id);
    finish(Response.json({ message: "old key succeeded", error: "old key rejected", models: [{ id: "old-model", name: "Old", operations: [] }] }, { status }));
    await checked;
    expect(getCachedModels(id)).toEqual(currentModels);
  });
});
