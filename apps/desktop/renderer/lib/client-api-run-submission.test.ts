import { afterEach, describe, expect, it, vi } from "vitest";
import { createRun } from "./client-api";

afterEach(() => vi.unstubAllGlobals());

describe("revision-bound run requests", () => {
  it.each(["node", "downstream", "all"] as const)("sends the saved click revision for %s without retrying", async scope => {
    const snapshot = { run: { id: "run", status: "queued" }, nodes: [] };
    const fetcher = vi.fn().mockResolvedValue(Response.json(snapshot, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const input = { canvasId: "canvas", clientRequestId: "click", expectedRevision: 7, scope,
      ...(scope !== "all" ? { nodeId: "image" } : {}) };
    await expect(createRun(input)).resolves.toEqual(snapshot);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/runs", expect.objectContaining({
      method: "POST", body: JSON.stringify(input),
    }));
  });

  it("keeps an explicit revision rejection out of submission-unknown handling", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      error: "提交前画布已修改，本次未提交、未产生费用，请确认后重新运行",
      code: "CANVAS_REVISION_CONFLICT", submissionPhase: "not_started",
    }, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    const error = await createRun({ canvasId: "canvas", clientRequestId: "click", expectedRevision: 7, scope: "all" })
      .catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("本次未提交、未产生费用");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
