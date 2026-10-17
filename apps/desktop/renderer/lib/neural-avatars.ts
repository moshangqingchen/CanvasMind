import { NEURAL_VERTEX_STRIDE } from "./neural-scene-geometry";
import { NEURAL_MODULES, type NeuralModule } from "./neural-tokens";

export interface NeuralAvatarData {
  version: 1; module: NeuralModule; scale: number; stride: 7;
  vertices: number[]; strokes: number[][]; fill: number[];
}

export const NEURAL_AVATAR_FILES: Record<NeuralModule, string> = Object.fromEntries(
  NEURAL_MODULES.map(module => [module, `/neural-avatars/${module}.json`]),
) as Record<NeuralModule, string>;

// Screen-space ribbons provide a real, portable line width: WebGL LINES are
// limited to one physical pixel on several desktop drivers. The extra fields
// are the opposite endpoint and the signed side of a narrow feathered strip.
export const NEURAL_AVATAR_STROKE_STRIDE = NEURAL_VERTEX_STRIDE + 4;

export function neuralAvatarStrokeTriangles(lines: Float32Array) {
  const triangles: number[] = [];
  const append = (offset: number, opposite: number, side: number) => {
    const vertex = [...lines.subarray(offset, offset + NEURAL_VERTEX_STRIDE)];
    // Point size is unused for triangles. Carry the tangent orientation here
    // so feathering has the same signed coordinate at both segment endpoints.
    vertex[6] = opposite > offset ? 1 : -1;
    triangles.push(...vertex, ...lines.subarray(opposite, opposite + 3), side);
  };
  for (let offset = 0; offset < lines.length; offset += NEURAL_VERTEX_STRIDE * 2) {
    const end = offset + NEURAL_VERTEX_STRIDE;
    // The opposite endpoint reverses the tangent, so its side is reversed too.
    for (const [at, other, side] of [[offset, end, -1], [end, offset, 1], [offset, end, 1], [offset, end, 1], [end, offset, 1], [end, offset, -1]]) append(at, other, side);
  }
  return new Float32Array(triangles);
}

/** Invalid decorative data is ignored; it never affects the accessible module controls. */
export function isNeuralAvatarData(input: unknown): input is NeuralAvatarData {
  if (!input || typeof input !== "object") return false;
  const data = input as NeuralAvatarData;
  if (data.version !== 1 || data.stride !== 7 || data.scale !== 1000 || !NEURAL_MODULES.includes(data.module)) return false;
  if (!Array.isArray(data.vertices) || !Array.isArray(data.fill) || !Array.isArray(data.strokes) || data.vertices.length % 7 || data.fill.length % 7 || data.vertices.length > 14000) return false;
  if (![...data.vertices, ...data.fill].every(n => Number.isFinite(n) && Math.abs(n) <= 1100)) return false;
  return data.strokes.every(stroke => Array.isArray(stroke) && stroke.length >= 2 && stroke.every(n => Number.isInteger(n) && n >= 0 && n < data.vertices.length / 7));
}

export function createNeuralAvatarGeometry(avatars: readonly NeuralAvatarData[]) {
  const lines: number[] = [], points: number[] = [];
  for (const avatar of avatars) {
    const group = NEURAL_MODULES.indexOf(avatar.module) + 1;
    const append = (target: number[], source: number[], offset: number, phase: number, fill: boolean) => {
      target.push(source[offset] / avatar.scale * .86, source[offset + 1] / avatar.scale * .86 - .34, source[offset + 2] / avatar.scale, group, source[offset + 3] / 255 * (fill ? .75 : .85), phase, fill ? 1.25 : 1, 1.15, ...source.slice(offset + 4, offset + 7).map(n => n / 255));
    };
    for (const stroke of avatar.strokes) {
      const lengths = [0];
      for (let i = 1; i < stroke.length; i++) lengths.push(lengths[i - 1] + Math.hypot(avatar.vertices[stroke[i] * 7] - avatar.vertices[stroke[i - 1] * 7], avatar.vertices[stroke[i] * 7 + 1] - avatar.vertices[stroke[i - 1] * 7 + 1]));
      for (let i = 0; i < stroke.length - 1; i++) for (const point of [i, i + 1]) append(lines, avatar.vertices, stroke[point] * 7, lengths[point] / Math.max(1, lengths.at(-1)!), false);
    }
    for (let offset = 0; offset < avatar.fill.length; offset += 7) append(points, avatar.fill, offset, offset / Math.max(7, avatar.fill.length), true);
  }
  if (lines.length % NEURAL_VERTEX_STRIDE || points.length % NEURAL_VERTEX_STRIDE) throw new Error("Invalid avatar vertex stride");
  return { lines: new Float32Array(lines), points: new Float32Array(points) };
}
