import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasCheckpointBuffer } from "./canvas-checkpoint-buffer";

afterEach(() => vi.useRealTimers());

describe("interactive canvas checkpoints", () => {
  it("bounds serialization during a continuous drag while regularly retaining the latest position", () => {
    vi.useFakeTimers();
    const buffer = new CanvasCheckpointBuffer<{ x: number }>();
    const serializeAndWriteDraft = vi.fn();
    for (let x = 1; x <= 120; x++) {
      buffer.queue({ x }, serializeAndWriteDraft);
      vi.advanceTimersByTime(10);
    }
    expect(serializeAndWriteDraft.mock.calls).toEqual([[{ x: 40 }], [{ x: 80 }], [{ x: 120 }]]);
  });

  it("allows pointer-up, manual save or pagehide to take the latest unsaved position immediately", () => {
    vi.useFakeTimers();
    const buffer = new CanvasCheckpointBuffer<{ x: number }>();
    const write = vi.fn();
    buffer.queue({ x: 10 }, write);
    vi.advanceTimersByTime(200);
    buffer.queue({ x: 25 }, write);
    expect(buffer.take()).toEqual({ x: 25 });
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
    expect(buffer.take()).toBeUndefined();
  });

  it("starts a new bounded interval after a checkpoint and cannot replay a cancelled project snapshot", () => {
    vi.useFakeTimers();
    const buffer = new CanvasCheckpointBuffer<string>();
    const oldProject = vi.fn();
    const newProject = vi.fn();
    buffer.queue("old", oldProject);
    buffer.take();
    buffer.queue("new", newProject);
    vi.advanceTimersByTime(400);
    expect(oldProject).not.toHaveBeenCalled();
    expect(newProject).toHaveBeenCalledExactlyOnceWith("new");
  });
});
