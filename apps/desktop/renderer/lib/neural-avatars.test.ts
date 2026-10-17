import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createNeuralAvatarGeometry, isNeuralAvatarData, neuralAvatarStrokeTriangles, NEURAL_AVATAR_STROKE_STRIDE } from "./neural-avatars";
import { NEURAL_MODULES } from "./neural-tokens";
import { NEURAL_VERTEX_STRIDE } from "./neural-scene-geometry";

describe("baked user character contours", () => {
  for (const moduleId of NEURAL_MODULES) it(`${moduleId} has compact, finite, ordered relief strokes and sparse fill`, () => {
    const path = fileURLToPath(new URL(`../public/neural-avatars/${moduleId}.json`, import.meta.url));
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(statSync(path).size).toBeLessThan(60000);
    expect(isNeuralAvatarData(data)).toBe(true);
    if (!isNeuralAvatarData(data)) throw new Error("Invalid baked avatar");
    expect(data.module).toBe(moduleId);
    expect(data.strokes.length).toBeGreaterThan(10);
    expect(data.fill.length / data.vertices.length).toBeGreaterThan(.2);
    expect(data.fill.length / data.vertices.length).toBeLessThan(.3);
    expect(data.vertices.some((n, i) => i % 7 === 2 && n > 30)).toBe(true);
    const geometry = createNeuralAvatarGeometry([data]);
    expect(geometry.lines.length % (NEURAL_VERTEX_STRIDE * 2)).toBe(0);
    expect([...geometry.lines, ...geometry.points].every(Number.isFinite)).toBe(true);
    for (const stroke of data.strokes) for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1] * 7, b = stroke[i] * 7;
      expect(Math.hypot(data.vertices[a] - data.vertices[b], data.vertices[a + 1] - data.vertices[b + 1])).toBeLessThan(1000);
    }
  });
  it("rejects corrupt decoration without trusting external indices", () => {
    expect(isNeuralAvatarData(null)).toBe(false);
    expect(isNeuralAvatarData({ version: 1, module: "canvases", scale: 1000, stride: 7, vertices: [0, 0, 0, 255, 0, 0, 0], fill: [], strokes: [[0, 8]] })).toBe(false);
  });
  it("gives each contour segment one finite, symmetric, feathered ribbon", () => {
    const a = [1, 2, .1, 1, .8, 0, 1, 1.15, .7, .6, .5];
    const b = [3, 4, .2, 1, .9, 1, 1, 1.15, .7, .6, .5];
    const result = neuralAvatarStrokeTriangles(new Float32Array([...a, ...b]));
    expect(result.length).toBe(6 * NEURAL_AVATAR_STROKE_STRIDE);
    expect([...result].every(Number.isFinite)).toBe(true);
    expect(Array.from({ length: 6 }, (_, i) => result[i * NEURAL_AVATAR_STROKE_STRIDE + 14])).toEqual([-1, 1, 1, 1, 1, -1]);
    const featherSides = Array.from({ length: 6 }, (_, i) => result[i * NEURAL_AVATAR_STROKE_STRIDE + 14] * result[i * NEURAL_AVATAR_STROKE_STRIDE + 6]);
    expect(featherSides).toEqual([-1, -1, 1, 1, -1, 1]);
    // Each physical long edge has a constant feather coordinate. Otherwise
    // interpolation puts a bright diagonal inside every triangle, scrambling faces.
    expect(featherSides[0]).toBe(featherSides[1]);
    expect(featherSides[2]).toBe(featherSides[3]);
    expect(featherSides[3]).toBe(featherSides[5]);
    expect([...result.slice(11, 14)]).toEqual([...new Float32Array(b.slice(0, 3))]);
    expect([...result.slice(15 + 11, 15 + 14)]).toEqual([...new Float32Array(a.slice(0, 3))]);
  });
});
