import { describe, expect, it, vi } from "vitest";
import { LatestTaskQueue } from "./latest-task-queue";

describe("LatestTaskQueue", () => {
  it("runs one task at a time and keeps only the newest queued value", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const processed: number[] = [];
    const queue = new LatestTaskQueue<number>(async (value) => {
      processed.push(value);
      if (value === 1) await firstGate;
    });

    const first = queue.enqueue(1);
    const second = queue.enqueue(2);
    const third = queue.enqueue(3);
    expect(processed).toEqual([1]);

    releaseFirst?.();
    await Promise.all([first, second, third]);
    expect(processed).toEqual([1, 3]);
  });

  it("continues with a newer task after a failure", async () => {
    const worker = vi.fn(async (value: string) => {
      if (value === "failed") throw new Error("save failed");
    });
    const queue = new LatestTaskQueue(worker);

    await expect(queue.enqueue("failed")).rejects.toThrow("save failed");
    await expect(queue.enqueue("latest")).resolves.toBeUndefined();
    expect(worker).toHaveBeenCalledTimes(2);
  });
});
