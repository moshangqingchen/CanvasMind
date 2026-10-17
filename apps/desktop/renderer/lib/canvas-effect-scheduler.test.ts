import { describe, expect, it } from "vitest";
import { canvasAmbientDetail, createCanvasEffectScheduler } from "./canvas-effect-scheduler";

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
