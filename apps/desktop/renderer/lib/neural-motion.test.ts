import { describe, expect, it } from "vitest";
import { neuralEntityOffset, neuralFrameInterval, neuralLayout, neuralParticleDrawRanges, stepNeuralQuality, stepNeuralSpring } from "./neural-motion";
import { parseNeuralColor } from "./neural-tokens";

describe("neural scene motion", () => {
  it("reduces each satellite's particles without hiding a module", () => {
    expect(neuralParticleDrawRanges(1640, 4, .55)).toEqual([
      { first: 0, count: 225 }, { first: 410, count: 225 },
      { first: 820, count: 225 }, { first: 1230, count: 225 },
    ]);
  });
  it("converges without bouncing at different frame rates", () => {
    for (const rate of [20, 30, 60, 144]) {
      let spring = { value: 0, velocity: 0 }, previous = 0;
      for (let frame = 0; frame < rate; frame++) {
        spring = stepNeuralSpring(spring, 100, 1 / rate);
        expect(spring.value).toBeGreaterThanOrEqual(previous);
        expect(spring.value).toBeLessThanOrEqual(100);
        previous = spring.value;
      }
      expect(spring.value).toBeCloseTo(100, 1);
    }
  });
  it("holds still when time does not advance", () => {
    const spring = { value: 3, velocity: 9 };
    expect(stepNeuralSpring(spring, 7, 0)).toBe(spring);
  });
  it("places the selected satellite in the center of the left column", () => {
    const hub = neuralLayout(1440, 900, null), selectedLayout = neuralLayout(1440, 900, "suppliers");
    expect(hub.core).toEqual({ x: 720, y: 432, radius: 198 });
    expect(hub.modules.canvases.radius).toBeCloseTo(74.88);
    expect(selectedLayout.modules.suppliers.radius).toBeCloseTo(77.76);
    expect(selectedLayout.core.x).toBeCloseTo(122.4);
    expect(selectedLayout.core.radius).toBe(54);
    expect(selectedLayout.modules.suppliers.y).toBe(450);
    expect(new Set(Object.values(selectedLayout.modules).map(point => point.y)).size).toBe(4);
    expect(selectedLayout.core.radius).toBeLessThan(hub.core.radius);
  });
  it("keeps small viewports finite and nonnegative", () => {
    const layout = neuralLayout(0, 0, "accounts");
    for (const point of [layout.core, ...Object.values(layout.modules)]) {
      expect(Number.isFinite(point.x + point.y + point.radius)).toBe(true);
      expect(point.radius).toBeGreaterThan(0);
    }
  });
  it("throttles inactive scenes and completely stops reduced motion", () => {
    expect(neuralFrameInterval(false, false, true)).toBe(Infinity);
    expect(neuralFrameInterval(true, true, true)).toBe(50);
    expect(neuralFrameInterval(true, false, false)).toBeCloseTo(1000 / 30);
  });
  it("degrades particles first, then bloom after another sustained two seconds", () => {
    let quality = { level: 0 as 0 | 1 | 2, slowSeconds: 0 };
    quality = stepNeuralQuality(quality, 25, 1);
    expect(quality.level).toBe(0);
    quality = stepNeuralQuality(quality, 25, 1);
    expect(quality.level).toBe(1);
    quality = stepNeuralQuality(quality, 25, 2);
    expect(quality.level).toBe(2);
    expect(stepNeuralQuality(quality, 5, 4)).toBe(quality);
  });
  it("recovers the slow-frame accumulator after healthy frames", () => {
    expect(stepNeuralQuality({ level: 0, slowSeconds: 1 }, 10, .5)).toEqual({ level: 0, slowSeconds: 0 });
  });
  it("gives stable identity-based positions and distinct entity positions", () => {
    expect(neuralEntityOffset("canvas-1", 0)).toEqual(neuralEntityOffset("canvas-1", 0));
    expect(neuralEntityOffset("canvas-1", 0)).not.toEqual(neuralEntityOffset("canvas-2", 0));
  });
  it("reads theme tokens without embedding a second palette in WebGL", () => {
    expect(parseNeuralColor("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(parseNeuralColor("rgb(12, 24, 36)")).toEqual([12 / 255, 24 / 255, 36 / 255]);
    expect(() => parseNeuralColor("")).toThrow("Missing neural scene color token");
  });
});
