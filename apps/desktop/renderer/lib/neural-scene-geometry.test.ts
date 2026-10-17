import { describe, expect, it } from "vitest";
import { createNeuralEntityGeometry, createNeuralGeometry, neuralEntityOrbit, NEURAL_VERTEX_STRIDE, selectNeuralEntities, type NeuralEntity } from "./neural-scene-geometry";
import { neuralLayout } from "./neural-motion";
import { NEURAL_MODULES } from "./neural-tokens";

describe("bounded, ordered neural decoration", () => {
  it("does not create points or lines for 2,646 models, but preserves owner search highlights", () => {
    const suppliers: NeuralEntity[] = Array.from({ length: 18 }, (_, i) => ({ id: `supplier:${i}`, module: "suppliers" }));
    const models: NeuralEntity[] = Array.from({ length: 2646 }, (_, i) => ({ id: `model:${i}`, module: "suppliers", parentId: `supplier:${i % 18}`, match: i === 7 }));
    const geometry = createNeuralEntityGeometry([...suppliers, ...models]);
    expect(geometry.points.length / NEURAL_VERTEX_STRIDE).toBe(18);
    expect(geometry.lines.length / NEURAL_VERTEX_STRIDE).toBe(18 * 16);
    expect(geometry.visible.find(entity => entity.id === "supplier:7")?.match).toBe(true);
    expect(createNeuralEntityGeometry(suppliers).lines.length).toBe(geometry.lines.length);
  });
  it("caps projects at 24 and one truthful +N aggregate", () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({ id: `canvas:${i}`, module: "canvases" as const }));
    const visible = selectNeuralEntities(entries);
    expect(visible).toHaveLength(25);
    expect(visible.at(-1)).toMatchObject({ aggregateCount: 176 });
  });
  it("uses at most two fixed radii with equal angular spacing inside each ring", () => {
    for (const count of [1, 5, 18, 25, 50, 180]) {
      const points = Array.from({ length: count }, (_, i) => neuralEntityOrbit(i, count));
      expect(new Set(points.map(point => point.radius)).size).toBeLessThanOrEqual(2);
      for (const ring of [0, 1]) {
        const angles = points.filter(point => point.ring === ring).map(point => point.angle);
        const gap = angles.length > 1 ? angles[1] - angles[0] : 0;
        for (let i = 1; i < angles.length; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(gap, 10);
      }
    }
  });
  it("keeps every entity arc short and inside the screen at real and extreme scales", () => {
    for (const selected of [null, ...NEURAL_MODULES]) for (const [width, height] of [[1440, 900], [1024, 700]]) {
      const entries: NeuralEntity[] = NEURAL_MODULES.flatMap(module => Array.from({ length: module === "suppliers" ? 50 : module === "canvases" ? 200 : 5 }, (_, i) => ({ id: `${module}:${i}`, module })));
      const data = createNeuralEntityGeometry(entries), layout = neuralLayout(width, height, selected);
      const lengths = new Map<number, number>();
      for (let i = 0; i < data.lines.length; i += NEURAL_VERTEX_STRIDE * 2) {
        const group = data.lines[i + 3], node = layout.modules[NEURAL_MODULES[group - 1]];
        const a = [node.x + data.lines[i] * node.radius, node.y + data.lines[i + 1] * node.radius];
        const b = [node.x + data.lines[i + NEURAL_VERTEX_STRIDE] * node.radius, node.y + data.lines[i + NEURAL_VERTEX_STRIDE + 1] * node.radius];
        for (const point of [a, b]) { expect(point[0]).toBeGreaterThan(0); expect(point[0]).toBeLessThan(width); expect(point[1]).toBeGreaterThan(0); expect(point[1]).toBeLessThan(height); }
        const arc = Math.floor(i / (NEURAL_VERTEX_STRIDE * 16));
        lengths.set(arc, (lengths.get(arc) ?? 0) + Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      expect(Math.max(...lengths.values())).toBeLessThan(Math.min(width, height) * .3);
    }
  });
  it("has 40 evenly distributed, flat, short rays and one beam per module", () => {
    const geometry = createNeuralGeometry(), stride = NEURAL_VERTEX_STRIDE;
    expect(geometry.rays.length / stride).toBe(40 * 8);
    expect(geometry.bundles.length / stride).toBe(4 * 48 * 2);
    const angles: number[] = [];
    for (let i = 0; i < geometry.rays.length; i += stride * 8) {
      const first = i, last = i + stride * 7;
      const start = Math.hypot(geometry.rays[first], geometry.rays[first + 1]), end = Math.hypot(geometry.rays[last], geometry.rays[last + 1]);
      expect(end - start).toBeGreaterThanOrEqual(.24999); expect(end - start).toBeLessThanOrEqual(.45001);
      expect(geometry.rays[first + 2]).toBe(0); expect(geometry.rays[last + 2]).toBe(0);
      expect(geometry.rays[first + 4]).toBe(0); expect(geometry.rays[last + 4]).toBeCloseTo(0);
      let angle = Math.atan2(geometry.rays[first + 1], geometry.rays[first]); if (angle < -.05) angle += Math.PI * 2; angles.push(angle);
    }
    angles.forEach((angle, i) => expect(Math.abs(angle - i / 40 * Math.PI * 2)).toBeLessThan(Math.PI / 60));
  });
});
