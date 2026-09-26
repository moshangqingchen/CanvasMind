import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const snapshot = () => ({
    run: { id: "run-1", status: "running" },
    nodes: [
      { id: "node-run-1", status: "running", outputAssetIds: [] as string[] },
    ],
  });
  return {
    snapshot,
    getRun:
      vi.fn<(id: string) => Promise<ReturnType<typeof snapshot> | null>>(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
});

vi.mock("../../../../../lib/server", () => ({
  runService: { getRun: mocks.getRun, subscribe: mocks.subscribe },
  publicRunSnapshot: (snapshot: unknown) => snapshot,
  publicRuntimeEvent: (event: unknown) => event,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.getRun.mockResolvedValue(mocks.snapshot());
  mocks.subscribe.mockReturnValue(mocks.unsubscribe);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const context = () => ({ params: Promise.resolve({ id: "run-1" }) });
const requestFor = (controller: AbortController) =>
  new Request("http://localhost/api/runs/run-1/events", {
    signal: controller.signal,
  });

describe("run event stream", () => {
  it("does not subscribe or start timers for an already aborted request", async () => {
    const abort = new AbortController();
    abort.abort();
    const response = await GET(requestFor(abort), context());
    expect(await response.body!.getReader().read()).toMatchObject({
      done: true,
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes a request aborted while its initial snapshot is loading", async () => {
    let resolveSnapshot!: (value: ReturnType<typeof mocks.snapshot>) => void;
    mocks.getRun.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const abort = new AbortController();
    const pending = GET(requestFor(abort), context());
    await Promise.resolve();
    abort.abort();
    resolveSnapshot(mocks.snapshot());
    const response = await pending;
    expect(await response.body!.getReader().read()).toMatchObject({
      done: true,
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases timers, subscriptions, and the abort listener when the reader cancels", async () => {
    const abort = new AbortController();
    const request = requestFor(abort);
    const removeListener = vi.spyOn(request.signal, "removeEventListener");
    const response = await GET(request, context());
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    abort.abort();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("closes once and releases resources when the request aborts", async () => {
    const abort = new AbortController();
    const response = await GET(requestFor(abort), context());
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    expect(await reader.read()).toMatchObject({ done: true });
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("suppresses an unchanged first poll and sends a run status change", async () => {
    const response = await GET(requestFor(new AbortController()), context());
    const reader = response.body!.getReader();
    await reader.read();
    let received = false;
    const next = reader.read().then((result) => {
      received = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toBe(false);
    mocks.getRun.mockResolvedValue({
      ...mocks.snapshot(),
      run: { id: "run-1", status: "succeeded" },
    });
    mocks.subscribe.mock.calls[0][0]({
      type: "run",
      runId: "run-1",
      payload: { status: "succeeded" },
    });
    expect(new TextDecoder().decode((await next).value)).toContain(
      '"status":"succeeded"',
    );
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      '"type":"snapshot"',
    );
    expect(await reader.read()).toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
    await reader.cancel();
  });

  it("keeps only one snapshot read in flight and ignores its result after cancellation", async () => {
    const response = await GET(requestFor(new AbortController()), context());
    const reader = response.body!.getReader();
    await reader.read();
    let resolveSnapshot!: (value: ReturnType<typeof mocks.snapshot>) => void;
    mocks.getRun.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.getRun).toHaveBeenCalledTimes(2);
    await reader.cancel();
    resolveSnapshot(mocks.snapshot());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.getRun).toHaveBeenCalledTimes(2);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shares reads and timers across subscribers and closes only after the last leaves", async () => {
    const first = await GET(requestFor(new AbortController()), context());
    const second = await GET(requestFor(new AbortController()), context());
    const a = first.body!.getReader();
    const b = second.body!.getReader();
    await a.read();
    await b.read();
    expect(mocks.getRun).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.getRun).toHaveBeenCalledTimes(2);
    await a.cancel();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    await b.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces events during an outstanding read and repairs the final state", async () => {
    const response = await GET(requestFor(new AbortController()), context());
    const reader = response.body!.getReader();
    await reader.read();
    let resolveSnapshot!: (value: ReturnType<typeof mocks.snapshot>) => void;
    mocks.getRun.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const onEvent = mocks.subscribe.mock.calls[0][0];
    onEvent({ type: "node", runId: "run-1", payload: { status: "running" } });
    onEvent({ type: "run", runId: "run-1", payload: { status: "succeeded" } });
    expect(mocks.getRun).toHaveBeenCalledTimes(2);
    mocks.getRun.mockResolvedValue({
      ...mocks.snapshot(),
      run: { id: "run-1", status: "succeeded" },
    });
    resolveSnapshot(mocks.snapshot());
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getRun).toHaveBeenCalledTimes(3);
    await reader.read();
    await reader.read();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      '"status":"succeeded"',
    );
    expect(await reader.read()).toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
