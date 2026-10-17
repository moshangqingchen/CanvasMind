import { describe, expect, it, vi } from "vitest";
import { canvasAmbientDetail, createCanvasEffectGestureGate, createCanvasEffectScheduler } from "./canvas-effect-scheduler";

describe("canvas decoration frame ownership", () => {
  it("has zero idle frames, coalesces events and sleeps after the final paint", () => {
    const pending = new Map<number, (time: number) => void>();
    let serial = 0, frames = 0;
    const scheduler = createCanvasEffectScheduler(() => ++frames < 3, callback => {
      pending.set(++serial, callback); return serial;
    }, handle => { pending.delete(handle); });
    expect(pending.size).toBe(0);
    scheduler.wake(); scheduler.wake();
    expect(pending.size).toBe(1);
    for (let time = 0; time < 3; time++) {
      const [id, callback] = [...pending][0]; pending.delete(id); callback(time);
    }
    expect(frames).toBe(3);
    expect(pending.size).toBe(0);
    expect(scheduler.active).toBe(false);
    scheduler.dispose(); scheduler.wake();
    expect(pending.size).toBe(0);
  });

  it("cancels the owned frame on suspension and unmount", () => {
    const pending = new Map<number, (time: number) => void>();
    let serial = 0;
    const scheduler = createCanvasEffectScheduler(() => true, callback => { pending.set(++serial, callback); return serial; }, id => { pending.delete(id); });
    scheduler.wake(); scheduler.stop(); expect(pending.size).toBe(0);
    scheduler.wake(); scheduler.dispose(); expect(pending.size).toBe(0);
  });

  it("disables decoration at low detail, high visible density and reduced motion", () => {
    expect(canvasAmbientDetail(true, .55, 150)).toBe("full");
    expect(canvasAmbientDetail(true, .549, 1)).toBe("off");
    expect(canvasAmbientDetail(true, 1, 151)).toBe("off");
    expect(canvasAmbientDetail(false, 1, 1)).toBe("off");
  });
});

describe("canvas decoration gesture suspension", () => {
  function fixture() {
    const pending = new Map<number, { callback: () => void; delay: number }>(); let serial = 0;
    const pause = vi.fn(), reconcile = vi.fn();
    const gate = createCanvasEffectGestureGate(pause, reconcile, (callback, delay) => {
      pending.set(++serial, { callback, delay }); return serial;
    }, handle => { pending.delete(handle); });
    const finish = () => { const [id, task] = [...pending][0]!; pending.delete(id); task.callback(); };
    return { gate, pause, reconcile, pending, finish };
  }
  it("suspends once for an entire pointer gesture and reconciles only on release", () => {
    const value = fixture(); expect(value.pending.size).toBe(0);
    value.gate.beginPointer(); value.gate.beginPointer();
    expect(value.gate.paused).toBe(true); expect(value.pause).toHaveBeenCalledTimes(1);
    expect(value.reconcile).not.toHaveBeenCalled(); expect(value.pending.size).toBe(0);
    value.gate.endPointer(); value.gate.endPointer();
    expect(value.gate.paused).toBe(false); expect(value.reconcile).toHaveBeenCalledTimes(1);
  });
  it("coalesces a wheel stream and rejects cancelled callbacks before one final reconciliation", () => {
    const value = fixture(); value.gate.wheel();
    const stale = [...value.pending.values()][0]!.callback;
    for (let index = 0; index < 24; index++) value.gate.wheel();
    expect(value.gate.paused).toBe(true); expect(value.pause).toHaveBeenCalledTimes(1);
    expect(value.pending.size).toBe(1); expect([...value.pending.values()][0]?.delay).toBe(180);
    stale(); expect(value.gate.paused).toBe(true); expect(value.reconcile).not.toHaveBeenCalled();
    value.finish(); expect(value.gate.paused).toBe(false); expect(value.reconcile).toHaveBeenCalledTimes(1);
    expect(value.pending.size).toBe(0);
  });
  it("waits for both a pointer gesture and wheel quiet period", () => {
    const value = fixture(); value.gate.beginPointer(); value.gate.wheel(); value.finish();
    expect(value.gate.paused).toBe(true); expect(value.reconcile).not.toHaveBeenCalled();
    value.gate.endPointer(); expect(value.reconcile).toHaveBeenCalledTimes(1);
    value.gate.wheel(); value.gate.beginPointer(); value.gate.endPointer();
    expect(value.gate.paused).toBe(true); expect(value.reconcile).toHaveBeenCalledTimes(1);
    value.finish(); expect(value.reconcile).toHaveBeenCalledTimes(2);
  });
  it("cancels pending reconciliation on hiding/reset and disposal without an idle timer", () => {
    const value = fixture(); value.gate.wheel(); const resetCallback = [...value.pending.values()][0]!.callback;
    value.gate.reset(); expect(value.gate.paused).toBe(false); expect(value.pending.size).toBe(0);
    resetCallback(); expect(value.reconcile).not.toHaveBeenCalled();
    value.gate.wheel(); const disposedCallback = [...value.pending.values()][0]!.callback;
    value.gate.dispose(); value.gate.beginPointer(); value.gate.wheel(); disposedCallback();
    expect(value.pending.size).toBe(0); expect(value.gate.paused).toBe(false); expect(value.reconcile).not.toHaveBeenCalled();
  });
});
