import { describe, expect, it } from "vitest";
import { createNeuralPlates, neuralPlateArea } from "./neural-plates";

describe("original irregular stone shell", () => {
  it("constructs deterministic closed polygonal cells rather than an equilateral triangle grid", () => {
    const plates = createNeuralPlates();
    expect(plates).toEqual(createNeuralPlates());
    expect(plates).toHaveLength(128);
    expect(plates.filter(plate => plate.boundary.length >= 4).length).toBeGreaterThan(105);
    for (const plate of plates) {
      expect(plate.boundary.length).toBeGreaterThanOrEqual(3);
      for (const point of plate.boundary) {
        expect(point.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...point)).toBeCloseTo(1, 6);
        const distance = point.reduce((sum, value, axis) => sum + value * plate.center[axis], 0);
        for (const other of plates) expect(point.reduce((sum, value, axis) => sum + value * other.center[axis], 0)).toBeLessThanOrEqual(distance + 1e-6);
      }
    }
  });
  it("varies cell size, fissure width, relief and rim width", () => {
    const plates = createNeuralPlates();
    const areas = plates.map(neuralPlateArea);
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(4);
    expect(Math.max(...plates.map(p => p.inset)) - Math.min(...plates.map(p => p.inset))).toBeGreaterThan(.12);
    expect(Math.max(...plates.map(p => p.rim)) / Math.min(...plates.map(p => p.rim))).toBeGreaterThan(3);
    expect(plates.some(p => p.open)).toBe(true);
  });
});
