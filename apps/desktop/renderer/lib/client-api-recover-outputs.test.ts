import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverRunOutputs } from "./client-api";

afterEach(() => vi.unstubAllGlobals());
describe("recoverRunOutputs", () => {
  it("uses the archive-only endpoint once and preserves the cancelled status", async () => {
    const snapshot = { run: { id: "run 1", status: "cancelled" }, nodes: [{ outputAssetIds: ["asset-1"] }] };
    const fetch = vi.fn().mockResolvedValue(Response.json(snapshot));
    vi.stubGlobal("fetch", fetch);
    expect(await recoverRunOutputs("run 1")).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/runs/run%201/recover-outputs", { method: "POST" });
  });

  it("surfaces a missing saved result without fallback submission or retry", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "没有保存的成功结果" }, { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    await expect(recoverRunOutputs("run-1")).rejects.toThrow("没有保存的成功结果");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
