import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { avatarConfig } from "./config.mjs";
import { borderBackground, foregroundDistance, simplifyPolyline, sobelEdges, thinEdges, traceEdges } from "./core.mjs";

const renderer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repository = path.resolve(renderer, "../../..");
const sources = path.join(repository, ".codex-logs/2026-10-16-redesign-v2/reference/avatars");
const assets = path.resolve(renderer, "../assets/neural-avatars");
const destination = path.join(renderer, "public/neural-avatars");
const previews = path.join(repository, ".codex-logs/2026-10-16-redesign-v2/out/avatars");
await Promise.all([assets, destination, previews].map(directory => mkdir(directory, { recursive: true })));
const size = 224;
for (const config of avatarConfig) {
  const croppedFile = path.join(assets, `${config.module}.png`);
  if (!process.argv.includes("--from-crops")) {
    const original = await readFile(path.join(sources, config.file));
    const { width, height } = await sharp(original).metadata();
    const [x, y, w, h] = config.crop;
    await sharp(original).extract({ left: Math.round(x * width), top: Math.round(y * height), width: Math.min(Math.round(w * width), width - Math.round(x * width)), height: Math.min(Math.round(h * height), height - Math.round(y * height)) }).png().toFile(croppedFile);
  }
  const original = await sharp(croppedFile).resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } }).ensureAlpha().raw().toBuffer();
  const smooth = await sharp(original, { raw: { width: size, height: size, channels: 4 } }).blur(config.smoothing).raw().toBuffer();
  const background = borderBackground(original, size, size);
  const foreground = Uint8Array.from(background, n => 1 - n);
  const luma = Float32Array.from(foreground, (_, i) => (smooth[i * 4] * .2126 + smooth[i * 4 + 1] * .7152 + smooth[i * 4 + 2] * .0722));
  const edges = sobelEdges(luma, foreground, size, size, config.threshold);
  // The outer silhouette and broad luminance regions survive the plush texture smoothing.
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    if (foreground[i] && [-1, 1, -size, size].some(o => !foreground[i + o])) edges[i] = 1;
    if (foreground[i] && config.levels?.some(level => luma[i] <= level * 255 && (luma[i + 1] > level * 255 || luma[i + size] > level * 255))) edges[i] = 1;
  }
  const rawPaths = traceEdges(thinEdges(edges, size, size), size, size);
  const distance = foregroundDistance(foreground, size, size);
  const vertex = ([x, y], intensity = 180) => {
    const i = Math.round(y) * size + Math.round(x), relief = Math.min(1, distance[i] / 42);
    return [Math.round((x / (size - 1) * 2 - 1) * 1000), Math.round((y / (size - 1) * 2 - 1) * 1000), Math.round(relief * 220), intensity, original[i * 4], original[i * 4 + 1], original[i * 4 + 2]];
  };
  let data;
  for (let tolerance = 1.05; tolerance <= 3.6; tolerance += .2) {
    const paths = rawPaths.map(points => simplifyPolyline(points, tolerance)).filter(points => points.length > 2 || Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) > 4);
    const vertices = [], strokes = [];
    for (const points of paths) {
      const stroke = [];
      for (const point of points) { stroke.push(vertices.length / 7); vertices.push(...vertex(point, point[1] / size > .31 && point[1] / size < .73 && point[0] / size > .25 && point[0] / size < .75 ? 245 : 185)); }
      strokes.push(stroke);
    }
    const fill = [], target = Math.floor(vertices.length / 7 * .24), candidates = [];
    // A fixed stratified lattice avoids both random clumps and dense texture noise.
    for (let y = 9; y < size - 9; y += 7) for (let x = 9 + ((y / 7) % 2 ? 3 : 0); x < size - 9; x += 7) {
      const i = y * size + x;
      if (foreground[i] && distance[i] > 3) candidates.push([x, y]);
    }
    for (let n = 0; n < Math.min(target, candidates.length); n++) {
      const point = candidates[Math.floor(n * candidates.length / Math.min(target, candidates.length))];
      fill.push(...vertex(point, Math.round(45 + (1 - luma[point[1] * size + point[0]] / 255) * 70)));
    }
    data = { version: 1, module: config.module, scale: 1000, stride: 7, vertices, strokes, fill };
    if (Buffer.byteLength(JSON.stringify(data)) < 59000) break;
  }
  const encoded = JSON.stringify(data);
  if (Buffer.byteLength(encoded) >= 60000) throw new Error(`Avatar too large: ${config.module}`);
  await writeFile(path.join(destination, `${config.module}.json`), encoded);
  const color = config.module === "canvases" ? "#c3bcf2" : config.module === "suppliers" ? "#ecc98f" : config.module === "accounts" ? "#ace0cf" : "#acd6e8";
  const xy = index => `${256 + data.vertices[index * 7] * .217},${256 + data.vertices[index * 7 + 1] * .217}`;
  const strokes = data.strokes.map(stroke => `<polyline points="${stroke.map(xy).join(" ")}"/>`).join("");
  const dots = Array.from({ length: data.fill.length / 7 }, (_, i) => `<circle cx="${256 + data.fill[i * 7] * .217}" cy="${256 + data.fill[i * 7 + 1] * .217}" r=".7" opacity=".3"/>`).join("");
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#0b0b0a"/><g fill="${color}">${dots}</g><g stroke="${color}" fill="none" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${strokes}</g></svg>`)).png().toFile(path.join(previews, `${config.module}-contours.png`));
  console.log(`${config.module}: ${Buffer.byteLength(encoded)} bytes; ${data.vertices.length / 7} contour vertices; ${data.strokes.length} ordered strokes; ${data.fill.length / 7} fill points`);
}
