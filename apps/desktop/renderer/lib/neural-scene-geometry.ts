import { NEURAL_MODULES, type NeuralModule } from "./neural-tokens";
import { neuralEntityOffset } from "./neural-motion";
import { createNeuralPlates } from "./neural-plates";

export interface NeuralEntity { id: string; module: NeuralModule; match?: boolean; parentId?: string }
export interface NeuralGeometry { shell: Float32Array; cage: Float32Array; rims: Float32Array; embers: Float32Array; satellites: Float32Array; tendrils: Float32Array; rays: Float32Array; bundles: Float32Array }

/** Eight floats per vertex: position, group, brightness, phase, point size, growth depth. */
export const NEURAL_VERTEX_STRIDE = 8;
type Vector = [number, number, number];
const unit = (v: Vector): Vector => { const length = Math.hypot(...v); return v.map(n => n / length) as Vector; };
const noise = (x: number, y: number, z: number) => Math.sin(x * 5.7 + y * 2.4) * Math.cos(z * 4.1 - x * 1.7) * .065 + Math.sin(y * 14.3 + z * 7.9 + x * 2.1) * .027;

export function neuralRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

function add(output: number[], p: Vector, group: number, light = 1, phase = 0, size = 1, depth = 0) {
  output.push(...p, group, light, phase, size, depth);
}

export function createNeuralGeometry(): NeuralGeometry {
  const random = neuralRandom(734917);
  const shell: number[] = [], cage: number[] = [], rims: number[] = [], embers: number[] = [], satellites: number[] = [], tendrils: number[] = [], rays: number[] = [], bundles: number[] = [];
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
    for (let i = 0; i < 620; i++) {
      const a = random() * Math.PI * 2, r = Math.sqrt(random()), z = random() * 2 - 1;
      const lobe = 1 + .09 * Math.sin(a * 5) + .06 * Math.sin(a * 9 + r * 4);
      let x = Math.cos(a) * r * lobe, y = -Math.sqrt(1 - r * r) * .72 + .13 * Math.cos(a * 2), depth = Math.sin(a) * r * .7 + z * .07;
      if (group === 1) {
        const band = Math.sqrt(1 - z * z);
        x = Math.cos(a) * band * lobe;
        y = z * .69 + Math.sin(a * 6 + z * 5) * .08;
        depth = Math.sin(a) * band * .7;
      } else if (group === 3) {
        x *= 1.12; y += Math.abs(Math.cos(a)) * .18;
      } else if (group === 4) {
        x *= .76; y = y * 1.3 + Math.sin(a * 3) * .11;
      }
      add(satellites, [x, y, depth], group, .35 + random() * .65, random(), .9 + random() * 1.5, 1.15);
    }
    for (let hair = 0; hair < 27; hair++) {
      const a = hair / 27 * Math.PI * 2, phase = random(), length = (.42 + random() * 1.1) * (group === 1 ? .53 : group === 4 ? 1.2 : 1);
      for (let segment = 0; segment < 15; segment++) {
        for (const step of [segment, segment + 1]) {
          const t = step / 15;
          const x = Math.cos(a) * (.65 * (1 - t * .3)) + Math.sin(t * 5.5 + phase * 6) * t * .16;
          const y = .02 + t * length;
          const z = Math.sin(a) * .49 + Math.cos(t * 4 + phase * 5) * t * .1;
          add(tendrils, [x, y, z], group, (1 - t) * .36, phase, 1, 1.2 + t * .5);
        }
      }
    }
    for (let branch = 0; branch < 5; branch++) {
      for (let segment = 0; segment < 40; segment++) {
        add(bundles, [segment / 40, (branch - 2) * .36, 0], group, branch === 2 ? .94 : .36, segment / 40, 1, 1);
        add(bundles, [(segment + 1) / 40, (branch - 2) * .36, 0], group, branch === 2 ? .94 : .36, (segment + 1) / 40, 1, 1);
      }
    }
  }
  for (let ray = 0; ray < 124; ray++) {
    const a = random() * Math.PI * 2, z = random() * 1.4 - .7, start = 1.02 + random() * .2, end = start + .16 + random() * .9;
    const p: Vector = [Math.cos(a), Math.sin(a), z];
    add(rays, p.map(n => n * start) as Vector, 0, .15 + random() * .2, random(), 1, .5);
    add(rays, p.map(n => n * end) as Vector, 0, .005, random(), 1, .8);
  }
  return Object.fromEntries(Object.entries({ shell, cage, rims, embers, satellites, tendrils, rays, bundles }).map(([key, values]) => [key, new Float32Array(values)])) as unknown as NeuralGeometry;
}

export function createNeuralEntityGeometry(entities: readonly NeuralEntity[]) {
  const points: number[] = [], lines: number[] = [];
  const indexes: Record<NeuralModule, number> = { canvases: 0, suppliers: 0, accounts: 0, starts: 0 };
  const entries = new Map(entities.map(entity => {
    const point = neuralEntityOffset(entity.id, indexes[entity.module]++);
    return [entity.id, { entity, p: [point.x / 44, point.y / 44, Math.sin(point.x) * .4] as Vector }];
  }));
  for (const { entity, p } of entries.values()) {
    const group = NEURAL_MODULES.indexOf(entity.module) + 1;
    const parent = entity.parentId ? entries.get(entity.parentId) : undefined;
    const origin = parent && parent.entity.module === entity.module ? parent.p : [0, 0, 0] as Vector;
    const depth = parent ? 2.2 : 1.75;
    const phase = (Math.sin(p[0] * 9 + p[1] * 5) + 1) / 2;
    add(points, p, group, entity.match ? 2.4 : .45, phase, entity.match ? 3.7 : 1.9, depth);
    add(lines, origin, group, entity.match ? .65 : .095, phase, 1, depth - .2);
    add(lines, p, group, entity.match ? .65 : .095, phase, 1, depth);
  }
  return { points: new Float32Array(points), lines: new Float32Array(lines) };
}
