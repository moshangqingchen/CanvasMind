import type { PositionedCanvasRect } from "./graph-ui";

type Point = { x: number; y: number };
export type CanvasPlacementItem = { id: string; width: number; height: number };
export interface CanvasPlacementOptions { gap?: number; columns?: number }

function overlaps(a: PositionedCanvasRect, b: PositionedCanvasRect, gap: number) {
  return a.position.x < b.position.x + b.width + gap && a.position.x + a.width + gap > b.position.x &&
    a.position.y < b.position.y + b.height + gap && a.position.y + a.height + gap > b.position.y;
}

/** Keep an imported grid together while finding the nearest clear drop position. */
export function placeCanvasBatch(
  items: readonly CanvasPlacementItem[], anchor: Point, occupied: readonly PositionedCanvasRect[], options: CanvasPlacementOptions = {},
): Map<string, Point> {
  if (!items.length) return new Map();
  const gap = options.gap ?? 24;
  const columns = Math.max(1, Math.min(5, Math.floor(options.columns ?? Math.ceil(Math.sqrt(items.length)))));
  const columnWidth = Math.max(...items.map(item => item.width));
  const offsets = new Map<string, Point>();
  let y = 0, width = 0;
  for (let start = 0; start < items.length; start += columns) {
    const row = items.slice(start, start + columns);
    row.forEach((item, index) => {
      const x = index * (columnWidth + gap);
      offsets.set(item.id, { x, y });
      width = Math.max(width, x + item.width);
    });
    y += Math.max(...row.map(item => item.height)) + gap;
  }
  const size = { width, height: y - gap };
  const placeAt = (origin: Point) => new Map(items.map(item => {
    const offset = offsets.get(item.id)!;
    return [item.id, { x: origin.x + offset.x, y: origin.y + offset.y }];
  }));
  if (!occupied.some(obstacle => overlaps({ id: "batch", position: anchor, ...size }, obstacle, gap))) return placeAt(anchor);
  const xs = [anchor.x], ys = [anchor.y];
  for (const obstacle of occupied) {
    xs.push(obstacle.position.x + obstacle.width + gap, obstacle.position.x - size.width - gap);
    ys.push(obstacle.position.y + obstacle.height + gap, obstacle.position.y - size.height - gap);
  }
  const byDistance = (origin: number) => (a: number, b: number) => (a - origin) ** 2 - (b - origin) ** 2 || a - b;
  const xValues = [...new Set(xs)].sort(byDistance(anchor.x)), yValues = [...new Set(ys)].sort(byDistance(anchor.y));
  type Candidate = { xIndex: number; yIndex: number; point: Point; distance: number };
  const queue: Candidate[] = [], visited = new Set<string>();
  const compare = (a: Candidate, b: Candidate) => a.distance - b.distance || a.point.y - b.point.y || a.point.x - b.point.x;
  const add = (xIndex: number, yIndex: number) => {
    if (xIndex >= xValues.length || yIndex >= yValues.length || visited.has(`${xIndex},${yIndex}`)) return;
    visited.add(`${xIndex},${yIndex}`);
    const point = { x: xValues[xIndex]!, y: yValues[yIndex]! };
    const candidate = { xIndex, yIndex, point, distance: (point.x - anchor.x) ** 2 + (point.y - anchor.y) ** 2 };
    queue.push(candidate);
    let index = queue.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(queue[parent]!, candidate) <= 0) break;
      queue[index] = queue[parent]!; index = parent;
    }
    queue[index] = candidate;
  };
  const take = () => {
    const first = queue[0]!, last = queue.pop()!;
    if (queue.length) {
      let index = 0;
      while (index * 2 + 1 < queue.length) {
        let child = index * 2 + 1;
        if (child + 1 < queue.length && compare(queue[child + 1]!, queue[child]!) < 0) child++;
        if (compare(last, queue[child]!) <= 0) break;
        queue[index] = queue[child]!; index = child;
      }
      queue[index] = last;
    }
    return first;
  };
  // Visit boundary intersections lazily, so a crowded canvas does not allocate a quadratic candidate list.
  add(0, 0);
  let origin = anchor;
  while (queue.length) {
    const candidate = take();
    if (!occupied.some(obstacle => overlaps({ id: "batch", position: candidate.point, ...size }, obstacle, gap))) { origin = candidate.point; break; }
    add(candidate.xIndex + 1, candidate.yIndex); add(candidate.xIndex, candidate.yIndex + 1);
  }
  return placeAt(origin);
}

/** Reflow only rows whose cards have not been moved since import. */
export function repairCanvasBatch(
  items: readonly PositionedCanvasRect[], expected: ReadonlyMap<string, Point>, occupied: readonly PositionedCanvasRect[], gap = 24,
): Map<string, Point> {
  const positions = new Map(items.map(item => [item.id, item.position]));
  const movable = items.filter(item => {
    const previous = expected.get(item.id);
    return previous && Math.abs(previous.x - item.position.x) < .5 && Math.abs(previous.y - item.position.y) < .5;
  });
  const movableIds = new Set(movable.map(item => item.id));
  const obstacles = [...occupied, ...items.filter(item => !movableIds.has(item.id))];
  const rows = new Map<number, PositionedCanvasRect[]>();
  for (const item of movable) {
    const row = rows.get(item.position.y) ?? [];
    row.push(item); rows.set(item.position.y, row);
  }
  for (const [originalY, row] of [...rows].sort(([a], [b]) => a - b)) {
    let y = originalY;
    for (;;) {
      const collisions = row.flatMap(item => obstacles.filter(obstacle => overlaps({ ...item, position: { x: item.position.x, y } }, obstacle, gap)));
      if (!collisions.length) break;
      y = Math.max(...collisions.map(item => item.position.y + item.height + gap));
    }
    for (const item of row) {
      const position = { x: item.position.x, y };
      positions.set(item.id, position); obstacles.push({ ...item, position });
    }
  }
  return positions;
}
