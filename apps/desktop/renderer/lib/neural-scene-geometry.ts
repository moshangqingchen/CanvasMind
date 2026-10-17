import { NEURAL_MODULES, type NeuralModule } from "./neural-tokens";
import { createNeuralPlates } from "./neural-plates";

export interface NeuralEntity { id: string; module: NeuralModule; match?: boolean; parentId?: string; aggregateCount?: number }
export interface NeuralGeometry { shell: Float32Array; cage: Float32Array; rims: Float32Array; embers: Float32Array; satellites: Float32Array; avatarLines: Float32Array; tendrils: Float32Array; rays: Float32Array; bundles: Float32Array }

/** Eleven floats: position, group, brightness, phase, point size, growth depth, optional source RGB. */
export const NEURAL_VERTEX_STRIDE = 11;
type Vector = [number, number, number];
const unit = (v: Vector): Vector => { const length = Math.hypot(...v); return v.map(n => n / length) as Vector; };
const noise = (x: number, y: number, z: number) => Math.sin(x * 5.7 + y * 2.4) * Math.cos(z * 4.1 - x * 1.7) * .065 + Math.sin(y * 14.3 + z * 7.9 + x * 2.1) * .027;

export function neuralRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

function add(output: number[], p: Vector, group: number, light = 1, phase = 0, size = 1, depth = 0) {
  output.push(...p, group, light, phase, size, depth, -1, -1, -1);
}

export function createNeuralGeometry(): NeuralGeometry {
  const random = neuralRandom(734917);
  const shell: number[] = [], cage: number[] = [], rims: number[] = [], embers: number[] = [], satellites: number[] = [], avatarLines: number[] = [], tendrils: number[] = [], rays: number[] = [], bundles: number[] = [];
  for (const plate of createNeuralPlates()) {
    if (plate.open) continue;
    const center = plate.center.map(n => n * plate.relief) as Vector;
    const roughBoundary = plate.boundary.flatMap((vertex, edge) => {
      const next = plate.boundary[(edge + 1) % plate.boundary.length];
      const perpendicular = unit([vertex[1] * next[2] - vertex[2] * next[1], vertex[2] * next[0] - vertex[0] * next[2], vertex[0] * next[1] - vertex[1] * next[0]]);
      return [0, 1 / 3, 2 / 3].map(t => {
        const irregularity = Math.sin(t * Math.PI) * (Math.sin(edge * 7.3 + plate.warmth * 37 + t * 13) * .012 + Math.cos(t * 19 + edge) * .006);
        return unit(vertex.map((n, axis) => n * (1 - t) + next[axis] * t + perpendicular[axis] * irregularity) as Vector);
      });
    });
    const outline = roughBoundary.map(vertex => {
      const direction = unit(vertex.map((n, axis) => n * plate.inset + plate.center[axis] * (1 - plate.inset)) as Vector);
      const relief = plate.relief + noise(...direction) * .45;
      return direction.map(n => n * relief) as Vector;
    });
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index], b = outline[(index + 1) % outline.length];
      for (const vertex of [center, a, b]) add(shell, vertex, 0, .8, plate.warmth, 1);
      // Polygon borders only. Internal triangle fan edges are never stroked.
      add(cage, a, 0, .27 + plate.warmth * .35, plate.warmth, 1);
      add(cage, b, 0, .27 + plate.warmth * .35, plate.warmth, 1);
      const innerA = a.map((n, axis) => n * (1 - plate.rim) + center[axis] * plate.rim) as Vector;
      const innerB = b.map((n, axis) => n * (1 - plate.rim) + center[axis] * plate.rim) as Vector;
      const outerLight = .46 + plate.warmth * .58;
      for (const [vertex, light] of [[a, outerLight], [b, outerLight], [innerA, 0], [b, outerLight], [innerB, 0], [innerA, 0]] as const) add(rims, vertex, 0, light, plate.warmth, 1);
    }
  }
  // A small additive furnace at the center makes the ember field read as light from within.
  for (const [size, brightness] of [[68, .35], [28, .95], [10, 1.7]]) add(embers, [0, .015, .2], 0, brightness, .9, size, .3);
  for (let i = 0; i < 3200; i++) {
    const azimuth = random() * Math.PI * 2, z = random() * 2 - 1;
    const radius = Math.pow(random(), 1.4) * .77, ring = Math.sqrt(1 - z * z);
    const spark = i < 130;
    add(embers, [Math.cos(azimuth) * ring * radius, z * radius, Math.sin(azimuth) * ring * radius], 0, spark ? 1.6 : .25 + random() * .75, random(), spark ? 2.7 + random() * 4 : .7 + Math.pow(random(), 5) * 3, .3);
  }
  for (let group = 1; group <= 4; group++) {
    // A few evenly spaced light filaments connect the character to its former neural form.
    for (let hair = 0; hair < 5; hair++) {
      for (let segment = 0; segment < 12; segment++) for (const step of [segment, segment + 1]) {
        const t = step / 12, x = (hair - 2) * .16;
        add(tendrils, [x + Math.sin(t * 2.6 + hair) * t * .045, .35 + t * .42, .04], group, (1 - t) * .22, t, 1, 1.3);
      }
    }
    for (let segment = 0; segment < 48; segment++) {
      for (const step of [segment, segment + 1]) {
        const t = step / 48;
        add(bundles, [t, .32, 0], group, .48, t, 1, .9);
      }
    }
  }
  // A short, evenly distributed corona. Each ray fades at both ends and stays in the core plane.
  for (let ray = 0; ray < 40; ray++) {
    const a = ray / 40 * Math.PI * 2 + (random() - .5) * Math.PI / 60;
    const start = 1.035, length = .25 + random() * .2;
    for (let segment = 0; segment < 4; segment++) for (const step of [segment, segment + 1]) {
      const t = step / 4, radius = start + t * length;
      add(rays, [Math.cos(a) * radius, Math.sin(a) * radius, 0], 0, Math.sin(t * Math.PI) * .15, t, 1, .6);
    }
  }
  return Object.fromEntries(Object.entries({ shell, cage, rims, embers, satellites, avatarLines, tendrils, rays, bundles }).map(([key, values]) => [key, new Float32Array(values)])) as unknown as NeuralGeometry;
}

/** Search keeps all model IDs; decoration contains only their owning item. */
export function selectNeuralEntities(entities: readonly NeuralEntity[]): NeuralEntity[] {
  const items = entities.filter(entity => !entity.parentId && !entity.id.startsWith("model:") && !entity.id.startsWith("account-model:"));
  const matches = new Set(entities.filter(entity => entity.match && entity.parentId).map(entity => entity.parentId));
  const result: NeuralEntity[] = [];
  for (const moduleId of NEURAL_MODULES) {
    const entries = items.filter(entity => entity.module === moduleId);
    const visible = moduleId === "canvases" ? entries.slice(0, 24) : entries;
    result.push(...visible.map(entity => ({ ...entity, match: entity.match || matches.has(entity.id) })));
    if (moduleId === "canvases" && entries.length > 24) result.push({ id: "aggregate:canvases", module: moduleId, aggregateCount: entries.length - 24, match: entries.slice(24).some(entity => entity.match) });
  }
  return result;
}

/** Equal angular spacing on one or two fixed arcs; all coordinates remain local to the satellite. */
export function neuralEntityOrbit(index: number, count: number): { x: number; y: number; angle: number; radius: number; ring: number } {
  const first = count > 12 ? Math.ceil(count / 2) : count;
  const ring = index < first ? 0 : 1;
  const ringCount = ring ? count - first : first, slot = ring ? index - first : index;
  const angle = Math.PI * (.94 + (ringCount <= 1 ? .56 : slot / (ringCount - 1) * 1.12));
  const radius = ring ? 1.62 : 1.36;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * .78 - .26, angle, radius, ring };
}

export function createNeuralEntityGeometry(entities: readonly NeuralEntity[]) {
  const points: number[] = [], lines: number[] = [], visible = selectNeuralEntities(entities);
  for (const moduleId of NEURAL_MODULES) {
    const entries = visible.filter(entity => entity.module === moduleId), group = NEURAL_MODULES.indexOf(moduleId) + 1;
    for (const [index, entity] of entries.entries()) {
      const orbit = neuralEntityOrbit(index, entries.length), depth = 1.75;
      const p: Vector = [orbit.x, orbit.y, 0];
      add(points, p, group, entity.match ? 2.2 : .62, index / Math.max(1, entries.length), entity.aggregateCount ? 3.5 : entity.match ? 3.5 : 2, depth);
      for (let segment = 0; segment < 8; segment++) for (const step of [segment, segment + 1]) {
        const t = step / 8, angle = orbit.angle + Math.sin(t * Math.PI) * .09, radius = .98 + (orbit.radius - .98) * t;
        add(lines, [Math.cos(angle) * radius, Math.sin(angle) * radius * .78 - .26, 0], group, (entity.match ? .6 : .14) * Math.sin((t * .8 + .1) * Math.PI), t, 1, depth - .15 + t * .15);
      }
    }
  }
  return { points: new Float32Array(points), lines: new Float32Array(lines), visible };
}
