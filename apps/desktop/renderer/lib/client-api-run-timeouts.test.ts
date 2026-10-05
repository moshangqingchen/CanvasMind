import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRun, fetchVisibleRuns } from "./client-api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("run synchronization deadlines", () => {
  it("releases a stalled snapshot request so the next polling cycle can recover without resubmitting", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const snapshot = { run: { id: "run", status: "running" }, nodes: [] };
    const fetcher = vi.fn()
      .mockImplementationOnce((_input: unknown, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      })
      .mockResolvedValueOnce(Response.json(snapshot));
    vi.stubGlobal("fetch", fetcher);
    let failure: unknown;
    const first = fetchRun("run").catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(failure).toMatchObject({ message: "运行状态读取超时，请稍后重试" });
    await first;
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(fetchRun("run")).resolves.toEqual(snapshot);
    expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === "GET")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds response-body reads and never returns partial visible-run batches", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json([{ run: { id: "run-0", createdAt: "2026-10-05" }, nodes: [] }]))
      .mockImplementationOnce(async (_input: unknown, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        return { ok: true, json: () => new Promise(() => undefined) } as unknown as Response;
      });
    vi.stubGlobal("fetch", fetcher);
    let failure: unknown;
    const pending = fetchVisibleRuns("canvas", Array.from({ length: 51 }, (_, index) => `run-${index}`), [])
      .catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(failure).toMatchObject({ message: "运行状态读取超时，请稍后重试" });
    await pending;
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["headers", "body"])("preserves caller cancellation during stalled %s instead of leaving the read pending", async phase => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn(async () => phase === "headers"
      ? new Promise<Response>(() => undefined)
      : { ok: true, json: () => new Promise(() => undefined) } as unknown as Response);
    vi.stubGlobal("fetch", fetcher);
    let failure: unknown;
    const pending = fetchRun("run", { details: true, signal: controller.signal }).catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).toMatchObject({ name: "AbortError" });
    await pending;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not send a read that was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchRun("run", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("releases a late response that arrives after the request deadline", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = fetchRun("run");
    const checked = expect(pending).rejects.toThrow("读取超时");
    await vi.advanceTimersByTimeAsync(15_001);
    await checked;
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
