import type {
  CanvasDrawingPoint,
  CanvasDrawingStroke,
} from "../components/types";

export interface DrawingRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function normalizeDrawingRect(
  start: CanvasDrawingPoint,
  end: CanvasDrawingPoint,
): DrawingRect {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

export function drawingStrokeBounds(
  stroke: CanvasDrawingStroke,
  extraPadding = 0,
): DrawingRect {
  const padding = stroke.width / 2 + extraPadding;
  let minX = stroke.points[0]?.x ?? 0;
  let minY = stroke.points[0]?.y ?? 0;
  let maxX = minX;
  let maxY = minY;
  for (const point of stroke.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

export function drawingBounds(
  strokes: readonly CanvasDrawingStroke[],
  extraPadding = 0,
): DrawingRect | null {
  if (strokes.length === 0) return null;
  const first = drawingStrokeBounds(strokes[0]!, extraPadding);
  const result = { ...first };
  for (const stroke of strokes.slice(1)) {
    const bounds = drawingStrokeBounds(stroke, extraPadding);
    result.minX = Math.min(result.minX, bounds.minX);
    result.minY = Math.min(result.minY, bounds.minY);
    result.maxX = Math.max(result.maxX, bounds.maxX);
    result.maxY = Math.max(result.maxY, bounds.maxY);
  }
  return result;
}

function pointToSegmentDistance(
  point: CanvasDrawingPoint,
  start: CanvasDrawingPoint,
  end: CanvasDrawingPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0)
    return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointHitsStroke(
  point: CanvasDrawingPoint,
  stroke: CanvasDrawingStroke,
  tolerance: number,
): boolean {
  const threshold = stroke.width / 2 + tolerance;
  if (stroke.points.length === 1) {
    const onlyPoint = stroke.points[0]!;
    return (
      Math.hypot(point.x - onlyPoint.x, point.y - onlyPoint.y) <= threshold
    );
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    if (
      pointToSegmentDistance(
        point,
        stroke.points[index - 1]!,
        stroke.points[index]!,
      ) <= threshold
    )
      return true;
  }
  return false;
}

export function hitTestDrawingStrokes(
  strokes: readonly CanvasDrawingStroke[],
  point: CanvasDrawingPoint,
  tolerance: number,
): CanvasDrawingStroke | null {
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index]!;
    if (pointHitsStroke(point, stroke, tolerance)) return stroke;
  }
  return null;
}

export function drawingStrokeIntersectsRect(
  stroke: CanvasDrawingStroke,
  rect: DrawingRect,
): boolean {
  const bounds = drawingStrokeBounds(stroke);
  return !(
    bounds.maxX < rect.minX ||
    bounds.minX > rect.maxX ||
    bounds.maxY < rect.minY ||
    bounds.minY > rect.maxY
  );
}

export function translateDrawingStrokes(
  strokes: readonly CanvasDrawingStroke[],
  selectedIds: ReadonlySet<string>,
  deltaX: number,
  deltaY: number,
): CanvasDrawingStroke[] {
  return strokes.map((stroke) =>
    selectedIds.has(stroke.id)
      ? {
          ...stroke,
          points: stroke.points.map((point) => ({
            x: point.x + deltaX,
            y: point.y + deltaY,
          })),
        }
      : stroke,
  );
}

export async function renderDrawingStrokesToPng(
  strokes: readonly CanvasDrawingStroke[],
): Promise<{
  file: File;
  bounds: DrawingRect;
  aspectRatio: number;
}> {
  const bounds = drawingBounds(strokes, 8);
  if (!bounds) throw new Error("请先选择要合并的涂鸦");
  const logicalWidth = Math.max(1, bounds.maxX - bounds.minX);
  const logicalHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(
    0.1,
    Math.min(2, 2048 / logicalWidth, 2048 / logicalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(logicalWidth * scale));
  canvas.height = Math.max(1, Math.ceil(logicalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建涂鸦图片");
  context.scale(scale, scale);
  context.translate(-bounds.minX, -bounds.minY);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;
    if (stroke.points.length === 1) {
      const point = stroke.points[0]!;
      context.beginPath();
      context.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
    for (const point of stroke.points.slice(1))
      context.lineTo(point.x, point.y);
    context.stroke();
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("涂鸦图片编码失败")),
      "image/png",
    ),
  );
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return {
    file: new File([blob], `涂鸦-${timestamp}.png`, { type: "image/png" }),
    bounds,
    aspectRatio: logicalWidth / logicalHeight,
  };
}
