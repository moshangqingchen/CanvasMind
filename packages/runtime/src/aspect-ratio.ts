function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b > 0) [a, b] = [b, a % b];
  return a || 1;
}

export function aspectRatioString(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  let bestWidth = 1;
  let bestHeight = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let height = 1; height <= 100; height += 1) {
    const width = Math.max(1, Math.round(value * height));
    const error = Math.abs(width / height - value);
    if (error < bestError) {
      bestWidth = width;
      bestHeight = height;
      bestError = error;
    }
  }
  const divisor = greatestCommonDivisor(bestWidth, bestHeight);
  return `${bestWidth / divisor}:${bestHeight / divisor}`;
}

function ratioFromParts(width: number, height: number): string | undefined {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width / height < 0.1 ||
    width / height > 10
  )
    return undefined;
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/** Reads an explicit ratio from the prompt before orientation words. */
export function aspectRatioFromPrompt(prompt: string): string | undefined {
  const text = prompt.trim();
  if (!text) return undefined;

  const ratio = /(?<!\d)(\d{1,2})\s*[:：/／]\s*(\d{1,2})(?!\d)/u.exec(text);
  if (ratio) {
    const parsed = ratioFromParts(Number(ratio[1]), Number(ratio[2]));
    if (parsed) return parsed;
  }

  const dimensions = /(?<!\d)(\d{2,5})\s*[x×*]\s*(\d{2,5})(?!\d)/iu.exec(text);
  if (dimensions) {
    const parsed = ratioFromParts(Number(dimensions[1]), Number(dimensions[2]));
    if (parsed) return parsed;
  }

  if (/(?:正方形|方形|square)/iu.test(text)) return "1:1";
  if (/(?:竖屏|竖版|纵向|人像|portrait|vertical)/iu.test(text)) return "9:16";
  if (/(?:横屏|横版|横向|风景|landscape|horizontal|wide)/iu.test(text))
    return "16:9";
  return undefined;
}
