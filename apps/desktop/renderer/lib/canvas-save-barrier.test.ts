import { describe, expect, it } from "vitest";
import { trackCanvasSave, waitForCanvasSaves } from "./canvas-save-barrier";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("canvas save barrier", () => {
  it("returns the original task and waits only for its own canvas", async () => {
    const task = deferred<number>();
    expect(trackCanvasSave("canvas-a", task.promise)).toBe(task.promise);
    let finished = false;
    const waiting = waitForCanvasSaves("canvas-a").then(() => { finished = true; });
    await waitForCanvasSaves("canvas-b");
    expect(finished).toBe(false);
    task.resolve(7);
    expect(await task.promise).toBe(7);
    await waiting;
    expect(finished).toBe(true);
    await expect(waitForCanvasSaves("canvas-a")).resolves.toBeUndefined();
  });
  it("also waits for saves registered while an earlier save settles", async () => {
    const first = deferred<void>();
    const later = deferred<void>();
    trackCanvasSave("canvas-new-work", first.promise);
    void first.promise.then(() => { trackCanvasSave("canvas-new-work", later.promise); });
    let finished = false;
    const waiting = waitForCanvasSaves("canvas-new-work").then(() => { finished = true; });
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(finished).toBe(false);
    later.resolve();
    await waiting;
    expect(finished).toBe(true);
  });
  it("does not swallow task failures but the recovery wait settles successfully", async () => {
    const task = deferred<void>();
    const failure = new Error("save failed");
    const tracked = trackCanvasSave("canvas-failed", task.promise);
    const waiting = waitForCanvasSaves("canvas-failed");
    task.reject(failure);
    await expect(tracked).rejects.toBe(failure);
    await expect(waiting).resolves.toBeUndefined();
    await expect(waitForCanvasSaves("canvas-failed")).resolves.toBeUndefined();
  });
  it("keeps a replacement set when new work is added after the previous set is cleaned", async () => {
    await trackCanvasSave("canvas-again", Promise.resolve());
    const next = deferred<void>();
    trackCanvasSave("canvas-again", next.promise);
    let finished = false;
    const waiting = waitForCanvasSaves("canvas-again").then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    next.resolve();
    await waiting;
    expect(finished).toBe(true);
  });
});
