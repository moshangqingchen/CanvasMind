import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshot } from "../components/types";
import { RunsQuerySchema } from "./api-validation";
import { fetchVisibleRuns } from "./client-api";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const snapshot = (runId: string, status: RunSnapshot["run"]["status"] = "running"): RunSnapshot => ({
  run: { id: runId, canvasId: "canvas", status, scope: "node", createdAt: "2026-09-26T10:00:00Z" },
  nodes: [],
});

afterEach(() => vi.unstubAllGlobals());

describe("visible run recovery", () => {
  it("returns the newest active task after 50 completed tasks under the real query limits", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => id(i));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const query = Object.fromEntries(new URL(input, "http://localhost").searchParams);
      expect(RunsQuerySchema.safeParse(query).success).toBe(true);
      return Response.json((query.runIds ?? "").split(",").slice(0, 50)
        .map((runId) => snapshot(runId, runId === ids[50] ? "running" : "succeeded")));
    }));
    const result = await fetchVisibleRuns("canvas", ids, []);
    expect(result).toHaveLength(51);
    expect(result.find((item) => item.run.id === ids[50])?.run.status).toBe("running");
  });

  it("recovers 180 output references without exceeding the 6500-character field limit", async () => {
    const unique = Array.from({ length: 18 }, (_, i) => id(i));
    const fetch = vi.fn(async (input: string) => {
      const query = Object.fromEntries(new URL(input, "http://localhost").searchParams);
      if (!RunsQuerySchema.safeParse(query).success)
        return Response.json({ error: "查询参数无效" }, { status: 400 });
      return Response.json(query.runIds.split(",").slice(0, 50).map((runId) => snapshot(runId)));
    });
    vi.stubGlobal("fetch", fetch);
    const result = await fetchVisibleRuns("canvas", unique.flatMap((value) => Array(10).fill(value)), []);
    expect(result.map((item) => item.run.id)).toEqual(unique);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("batches pending request IDs too and deduplicates runs matched by both identifiers", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => id(i));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const query = new URL(input, "http://localhost").searchParams;
      const runIds = (query.get("runIds") ?? "").split(",").filter(Boolean);
      const requestIds = (query.get("clientRequestIds") ?? "").split(",").filter(Boolean);
      return Response.json([...runIds.slice(0, 50), ...requestIds.slice(0, 50)].map((runId) => snapshot(runId)));
    }));
    expect(await fetchVisibleRuns("canvas", ids, ids.flatMap((value) => [value, value]))).toHaveLength(101);
  });

  it("rejects a partial lookup instead of reporting a successful but incomplete snapshot", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => id(i));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const query = new URL(input, "http://localhost").searchParams;
      if (query.get("runIds") === ids[50]) return new Response(null, { status: 503 });
      return Response.json(ids.slice(0, 50).map((runId) => snapshot(runId, "succeeded")));
    }));
    await expect(fetchVisibleRuns("canvas", ids, [])).rejects.toThrow("无法读取当前运行状态");
  });

  it("does not fall back to loading the entire history when no task is referenced", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await fetchVisibleRuns("canvas", [], [])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
