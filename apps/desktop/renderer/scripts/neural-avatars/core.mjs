/** Original deterministic image-to-polyline processing, with no runtime image dependency. */
export function borderBackground(rgba, width, height) {
  const mask = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const visit = index => {
    if (mask[index]) return;
    const offset = index * 4, colors = [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
    if (Math.min(...colors) < 228 || Math.max(...colors) - Math.min(...colors) > 23) return;
    mask[index] = 1; queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    if (x) visit(index - 1); if (x < width - 1) visit(index + 1);
    if (y) visit(index - width); if (y < height - 1) visit(index + width);
  }
  return mask;
}

export function sobelEdges(luma, foreground, width, height, threshold) {
  const result = new Uint8Array(width * height), magnitude = new Float32Array(width * height), directions = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (!foreground[i]) continue;
    const gx = -luma[i - width - 1] + luma[i - width + 1] - 2 * luma[i - 1] + 2 * luma[i + 1] - luma[i + width - 1] + luma[i + width + 1];
    const gy = -luma[i - width - 1] - 2 * luma[i - width] - luma[i - width + 1] + luma[i + width - 1] + 2 * luma[i + width] + luma[i + width + 1];
    magnitude[i] = Math.hypot(gx, gy);
    directions[i] = Math.round((Math.atan2(gy, gx) + Math.PI) / (Math.PI / 4)) % 4;
  }
  const offsets = [1, width + 1, width, width - 1];
  for (let i = width + 1; i < result.length - width - 1; i++) {
    const o = offsets[directions[i]];
    if (magnitude[i] >= threshold && magnitude[i] >= magnitude[i - o] && magnitude[i] >= magnitude[i + o]) result[i] = 1;
  }
  return result;
}

/** Zhang–Suen thinning, followed by graph tracing. Junctions are split into ordered strokes. */
export function thinEdges(input, width, height) {
  const image = input.slice();
  for (let iteration = 0; iteration < 32; iteration++) {
    let removed = 0;
    for (let pass = 0; pass < 2; pass++) {
      const erase = [];
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!image[i]) continue;
        const p = [-width, -width + 1, 1, width + 1, width, width - 1, -1, -width - 1].map(o => image[i + o]);
        const count = p.reduce((a, b) => a + b, 0), transitions = p.reduce((a, b, n) => a + (!b && p[(n + 1) % 8] ? 1 : 0), 0);
        if (count < 2 || count > 6 || transitions !== 1) continue;
        if (pass === 0 ? p[0] * p[2] * p[4] === 0 && p[2] * p[4] * p[6] === 0 : p[0] * p[2] * p[6] === 0 && p[0] * p[4] * p[6] === 0) erase.push(i);
      }
      for (const i of erase) image[i] = 0;
      removed += erase.length;
    }
    if (!removed) break;
  }
  return image;
}

export function traceEdges(image, width, height) {
  const seen = new Set(), paths = [], neighbors = i => {
    const x = i % width, y = Math.floor(i / width), found = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const n = i + dy * width + dx;
      if (dx && dy && (image[i + dx] || image[i + dy * width])) continue;
      if (image[n]) found.push(n);
    }
    return found;
  };
  const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const starts = [...image.keys()].filter(i => image[i]).sort((a, b) => (neighbors(a).length === 2 ? 1 : 0) - (neighbors(b).length === 2 ? 1 : 0));
  for (const start of starts) for (const next of neighbors(start)) {
    if (seen.has(key(start, next))) continue;
    const path = [start]; let previous = start, current = next;
    while (true) {
      seen.add(key(previous, current)); path.push(current);
      const choices = neighbors(current).filter(n => n !== previous && !seen.has(key(current, n)));
      if (!choices.length || current === start) break;
      const dx = current % width - previous % width, dy = Math.floor(current / width) - Math.floor(previous / width);
      choices.sort((a, b) => {
        const alignment = n => {
          const nx = n % width - current % width, ny = Math.floor(n / width) - Math.floor(current / width);
          return (nx * dx + ny * dy) / Math.hypot(nx, ny);
        };
        return alignment(b) - alignment(a);
      });
      previous = current; current = choices[0];
    }
    if (path.length >= 6) paths.push(path.map(i => [i % width, Math.floor(i / width)]));
  }
  return paths;
}

export function simplifyPolyline(points, tolerance) {
  if (points.length <= 2) return points;
  const a = points[0], b = points.at(-1), dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  let furthest = 0, distance = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
    const squared = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
    if (squared > distance) { distance = squared; furthest = i; }
  }
  return furthest ? [...simplifyPolyline(points.slice(0, furthest + 1), tolerance).slice(0, -1), ...simplifyPolyline(points.slice(furthest), tolerance)] : [a, b];
}

export function foregroundDistance(foreground, width, height) {
  const distance = Float32Array.from(foreground, n => n ? 10000 : 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x < width - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (y < height - 1) distance[i] = Math.min(distance[i], distance[i + width] + 1);
  }
  return distance;
}
