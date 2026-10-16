/** Original spherical Voronoi construction; no triangulated geodesic lattice is displayed. */
export type NeuralVector = [number, number, number];
export interface NeuralPlate {
  center: NeuralVector;
  boundary: NeuralVector[];
  inset: number;
  relief: number;
  rim: number;
  warmth: number;
  open: boolean;
}
const dot = (a: NeuralVector, b: NeuralVector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: NeuralVector, b: NeuralVector): NeuralVector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (p: NeuralVector): NeuralVector => { const length = Math.hypot(...p); return p.map(value => value / length) as NeuralVector; };

export function createNeuralPlates(seed = 928763, count = 128): NeuralPlate[] {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const sites: NeuralVector[] = [];
  for (let attempt = 0; sites.length < count && attempt < count * 200; attempt++) {
    const z = random() * 2 - 1, angle = random() * Math.PI * 2, ring = Math.sqrt(1 - z * z);
    const point: NeuralVector = [Math.cos(angle) * ring, Math.sin(angle) * ring, z];
    // A loose exclusion prevents sliver cells, while random density keeps plate sizes unequal.
    if (sites.every(site => dot(point, site) < .995)) sites.push(point);
  }
  return sites.flatMap((center, index) => {
    const planes = sites.filter((_, i) => i !== index).map(other => ({
      normal: center.map((value, axis) => value - other[axis]) as NeuralVector,
      distance: dot(center, other),
    })).sort((a, b) => b.distance - a.distance);
    const local = planes.slice(0, 24);
    const boundary: NeuralVector[] = [];
    for (let a = 0; a < local.length; a++) for (let b = a + 1; b < local.length; b++) {
      const intersection = cross(local[a].normal, local[b].normal);
      if (Math.hypot(...intersection) < 1e-7) continue;
      const candidate = normalize(intersection);
      for (const sign of [1, -1]) {
        const point = candidate.map(value => value * sign) as NeuralVector;
        if (dot(point, center) <= 0 || planes.some(plane => dot(point, plane.normal) < -1e-7)) continue;
        if (boundary.every(previous => dot(point, previous) < .99999999)) boundary.push(point);
      }
    }
    if (boundary.length < 3) return [];
    const tangent = normalize(cross(center, Math.abs(center[2]) < .9 ? [0, 0, 1] : [0, 1, 0]));
    const bitangent = cross(center, tangent);
    boundary.sort((a, b) => Math.atan2(dot(a, bitangent), dot(a, tangent)) - Math.atan2(dot(b, bitangent), dot(b, tangent)));
    const warmth = random();
    return [{ center, boundary, inset: .85 + random() * .135, relief: .9 + random() * .13,
      rim: .018 + random() ** 2 * .085, warmth, open: warmth > .985 || (center[2] > .97 && warmth > .4) }];
  });
}

export function neuralPlateArea(plate: Pick<NeuralPlate, "center" | "boundary">): number {
  return plate.boundary.reduce((sum, point, index) => {
    const next = plate.boundary[(index + 1) % plate.boundary.length];
    const a = point.map((value, axis) => value - plate.center[axis]) as NeuralVector;
    const b = next.map((value, axis) => value - plate.center[axis]) as NeuralVector;
    return sum + Math.hypot(...cross(a, b)) / 2;
  }, 0);
}
