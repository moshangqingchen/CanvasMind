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

/** Reads an explicit WIDTHxHEIGHT request without deciding a provider limit. */
export function dimensionsFromPrompt(prompt: string): string | undefined {
  const dimensions = /(?<!\d)(\d{2,5})\s*[x×*]\s*(\d{2,5})(?!\d)/iu.exec(
    prompt.trim(),
  );
  if (!dimensions) return undefined;
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  return ratioFromParts(width, height) ? `${width}x${height}` : undefined;
}

function numericRatio(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/u.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

const WEAI_SIZES_BY_TIER = {
  "1K": [{ ratio: 1, size: "1024x1024" }],
  "2K": [
    { ratio: 1, size: "2048x2048" },
    { ratio: 16 / 9, size: "2048x1152" },
  ],
  "4K": [
    { ratio: 1, size: "2160x2160" },
    { ratio: 16 / 9, size: "3840x2160" },
    { ratio: 9 / 16, size: "2160x3840" },
    { ratio: 4 / 3, size: "2880x2160" },
    { ratio: 3 / 4, size: "2160x2880" },
    { ratio: 3 / 2, size: "3264x2176" },
    { ratio: 2 / 3, size: "2176x3264" },
    { ratio: 21 / 9, size: "3840x1648" },
  ],
} as const;

const FRIMODEL_SIZES_BY_TIER = {
  "1K": [
    { ratio: 1, size: "1024x1024" },
    { ratio: 2 / 3, size: "1024x1536" },
    { ratio: 3 / 2, size: "1536x1024" },
    { ratio: 3 / 4, size: "768x1024" },
    { ratio: 4 / 3, size: "1024x768" },
    { ratio: 4 / 5, size: "768x960" },
    { ratio: 5 / 4, size: "960x768" },
    { ratio: 9 / 16, size: "1088x1920" },
    { ratio: 16 / 9, size: "1920x1088" },
    { ratio: 21 / 9, size: "1920x816" },
    { ratio: 9 / 21, size: "816x1920" },
  ],
  "2K": [
    { ratio: 1, size: "2048x2048" },
    { ratio: 2 / 3, size: "2048x3072" },
    { ratio: 3 / 2, size: "3072x2048" },
    { ratio: 3 / 4, size: "2048x2736" },
    { ratio: 4 / 3, size: "2736x2048" },
    { ratio: 4 / 5, size: "1600x2000" },
    { ratio: 5 / 4, size: "2000x1600" },
    { ratio: 9 / 16, size: "1440x2560" },
    { ratio: 16 / 9, size: "2560x1440" },
    { ratio: 21 / 9, size: "2560x1104" },
    { ratio: 9 / 21, size: "1104x2560" },
  ],
  "4K": [
    { ratio: 1, size: "2880x2880" },
    { ratio: 2 / 3, size: "2352x3520" },
    { ratio: 3 / 2, size: "3520x2352" },
    { ratio: 3 / 4, size: "2480x3312" },
    { ratio: 4 / 3, size: "3312x2480" },
    { ratio: 4 / 5, size: "2560x3200" },
    { ratio: 5 / 4, size: "3200x2560" },
    { ratio: 9 / 16, size: "2160x3840" },
    { ratio: 16 / 9, size: "3840x2160" },
    { ratio: 21 / 9, size: "3840x1648" },
    { ratio: 9 / 21, size: "1648x3840" },
  ],
} as const;

const MIKOTO_SIZES_BY_TIER = {
  "1K": [{ ratio: 1, size: "1024x1024" }],
  "2K": [
    { ratio: 1, size: "1440x1440" },
    { ratio: 16 / 9, size: "2560x1440" },
    { ratio: 9 / 16, size: "1152x2048" },
    { ratio: 4 / 3, size: "1920x1440" },
    { ratio: 3 / 4, size: "1440x1920" },
    { ratio: 3 / 2, size: "2160x1440" },
    { ratio: 2 / 3, size: "1440x2160" },
    { ratio: 21 / 9, size: "2560x1097" },
  ],
  "4K": [
    { ratio: 1, size: "2160x2160" },
    { ratio: 16 / 9, size: "3840x2160" },
    { ratio: 9 / 16, size: "2160x3840" },
    { ratio: 4 / 3, size: "2880x2160" },
    { ratio: 3 / 4, size: "2160x2880" },
    { ratio: 3 / 2, size: "3240x2160" },
    { ratio: 2 / 3, size: "2160x3240" },
    { ratio: 21 / 9, size: "3840x1646" },
  ],
} as const;

const GPT_IMAGE_4K_SIZES = [
  { ratio: 1, size: "2160x2160" },
  { ratio: 5 / 4, size: "3200x2560" },
  { ratio: 7 / 6, size: "3104x2656" },
  { ratio: 9 / 16, size: "2160x3840" },
  { ratio: 21 / 9, size: "3840x1648" },
  { ratio: 16 / 9, size: "3840x2160" },
  { ratio: 3 / 2, size: "3264x2176" },
  { ratio: 4 / 3, size: "2880x2160" },
  { ratio: 4 / 5, size: "2560x3200" },
  { ratio: 3 / 4, size: "2160x2880" },
  { ratio: 2 / 3, size: "2176x3264" },
] as const;

const GPT_IMAGE_4K_MAX_EDGE = 3840;
const GPT_IMAGE_4K_MAX_PIXELS = 3840 * 2160;
const GPT_IMAGE_4K_EDGE_STEP = 16;
// Only exact (within floating-point noise) documented ratios use their
// provider-tested presets. A user ratio such as 100:99 must remain custom
// rather than being silently rounded to square.
const GPT_IMAGE_4K_CANONICAL_RATIO_TOLERANCE = 1e-6;

/** Builds a custom K-tier canvas while honoring the provider's size limits. */
function customImageSizeForRatio(
  requested: number,
  maxEdge: number,
  maxPixels: number,
): string {
  // GPT Image 2 rejects edge ratios wider/taller than 3:1. Clamp only when a
  // prompt asks for an unsupported extreme; all normal custom ratios retain
  // their requested proportions.
  const ratio = Math.min(3, Math.max(1 / 3, requested));
  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = Math.min(maxEdge, Math.sqrt(maxPixels * ratio));
    height = width / ratio;
  } else {
    height = Math.min(maxEdge, Math.sqrt(maxPixels / ratio));
    width = height * ratio;
  }

  width = Math.max(
    GPT_IMAGE_4K_EDGE_STEP,
    Math.round(width / GPT_IMAGE_4K_EDGE_STEP) * GPT_IMAGE_4K_EDGE_STEP,
  );
  height = Math.max(
    GPT_IMAGE_4K_EDGE_STEP,
    Math.round(height / GPT_IMAGE_4K_EDGE_STEP) * GPT_IMAGE_4K_EDGE_STEP,
  );
  width = Math.min(maxEdge, width);
  height = Math.min(maxEdge, height);

  while (width * height > maxPixels) {
    if (width >= height) width -= GPT_IMAGE_4K_EDGE_STEP;
    else height -= GPT_IMAGE_4K_EDGE_STEP;
  }
  return `${width}x${height}`;
}

function customGptImage4KSizeForRatio(requested: number): string {
  return customImageSizeForRatio(
    requested,
    GPT_IMAGE_4K_MAX_EDGE,
    GPT_IMAGE_4K_MAX_PIXELS,
  );
}

/** Builds a provider-compatible custom canvas from a normalized ratio. */
export function customImageSizeForAspectRatio(
  aspectRatio: string | undefined,
  limits: { maxEdge: number; maxPixels: number } = {
    maxEdge: GPT_IMAGE_4K_MAX_EDGE,
    maxPixels: GPT_IMAGE_4K_MAX_PIXELS,
  },
): string | undefined {
  const requested = aspectRatio ? numericRatio(aspectRatio) : undefined;
  if (!requested) return undefined;
  return customImageSizeForRatio(
    requested,
    limits.maxEdge,
    limits.maxPixels,
  );
}

type AspectRatioSizeCandidate = {
  readonly ratio: number;
  readonly size: string;
};

const AUTO_TIER_CANVAS_LIMITS = {
  // These bounds keep automatic custom sizes inside the documented ranges
  // shared by the OpenAI-compatible 1K/2K/4K routes.
  "1K": { maxEdge: 1824, maxPixels: 1824 * 1024 },
  "2K": { maxEdge: 2048, maxPixels: 2048 * 1536 },
  "4K": { maxEdge: 3840, maxPixels: 3840 * 2160 },
} as const;

function sizeForAspectRatioCandidates(
  candidates: readonly AspectRatioSizeCandidate[],
  aspectRatio: string | undefined,
  limits?: (typeof AUTO_TIER_CANVAS_LIMITS)[keyof typeof AUTO_TIER_CANVAS_LIMITS],
): string {
  const requested = aspectRatio ? numericRatio(aspectRatio) : undefined;
  if (!requested)
    return candidates.find((candidate) => candidate.ratio === 1)?.size ??
      candidates[0]?.size ??
      "1024x1024";
  const nearest = candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.ratio / requested));
    const candidateDistance = Math.abs(Math.log(candidate.ratio / requested));
    return candidateDistance < bestDistance ? candidate : best;
  });
  const nearestDistance = Math.abs(Math.log(nearest.ratio / requested));
  if (!limits || nearestDistance <= GPT_IMAGE_4K_CANONICAL_RATIO_TOLERANCE)
    return nearest.size;
  return customImageSizeForRatio(
    requested,
    limits.maxEdge,
    limits.maxPixels,
  );
}

/** Maps an automatic prompt/reference ratio to the Cangyuan GPT Image 4K canvas. */
export function gptImage4KSizeForAspectRatio(
  aspectRatio?: string,
): string {
  const requested = aspectRatio ? numericRatio(aspectRatio) : undefined;
  if (!requested) return GPT_IMAGE_4K_SIZES[0].size;
  const nearest = GPT_IMAGE_4K_SIZES.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.ratio / requested));
    const candidateDistance = Math.abs(
      Math.log(candidate.ratio / requested),
    );
    return candidateDistance < bestDistance ? candidate : best;
  });
  const nearestDistance = Math.abs(Math.log(nearest.ratio / requested));
  return nearestDistance <= GPT_IMAGE_4K_CANONICAL_RATIO_TOLERANCE
    ? nearest.size
    : customGptImage4KSizeForRatio(requested);
}

export type WeAiResolutionTier = keyof typeof WEAI_SIZES_BY_TIER;

export function weAiResolutionTier(value: unknown): WeAiResolutionTier | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === "1K" || normalized === "2K" || normalized === "4K"
    ? normalized
    : undefined;
}

/** Keeps automatic prompt/reference sizing inside the selected We-AI K tier. */
export function weAiSizeForResolutionTier(
  tierValue: unknown,
  aspectRatio?: string,
): string | undefined {
  const tier = weAiResolutionTier(tierValue);
  if (!tier) return undefined;
  const candidates = WEAI_SIZES_BY_TIER[tier];
  return sizeForAspectRatioCandidates(
    candidates,
    aspectRatio,
    AUTO_TIER_CANVAS_LIMITS[tier],
  );
}

export type FriModelResolutionTier = keyof typeof FRIMODEL_SIZES_BY_TIER;

/** Keeps FriModel automatic sizing inside the selected resolution tier. */
export function friModelSizeForResolutionTier(
  tierValue: unknown,
  aspectRatio?: string,
): string | undefined {
  const tier = weAiResolutionTier(tierValue) as FriModelResolutionTier | undefined;
  if (!tier) return undefined;
  const candidates = FRIMODEL_SIZES_BY_TIER[tier];
  return sizeForAspectRatioCandidates(
    candidates,
    aspectRatio,
    AUTO_TIER_CANVAS_LIMITS[tier],
  );
}

export type MikotoResolutionTier = keyof typeof MIKOTO_SIZES_BY_TIER;

/** Keeps Mikoto automatic sizing inside the selected resolution tier. */
export function mikotoSizeForResolutionTier(
  tierValue: unknown,
  aspectRatio?: string,
): string | undefined {
  const tier = weAiResolutionTier(tierValue) as MikotoResolutionTier | undefined;
  if (!tier) return undefined;
  const candidates = MIKOTO_SIZES_BY_TIER[tier];
  return sizeForAspectRatioCandidates(
    candidates,
    aspectRatio,
    AUTO_TIER_CANVAS_LIMITS[tier],
  );
}

const CHENTU_SIZES_BY_TIER = {
  "1K": [
    { ratio: 1, size: "1024x1024" },
    { ratio: 9 / 16, size: "720x1280" },
    { ratio: 16 / 9, size: "1280x720" },
    { ratio: 4 / 3, size: "1024x768" },
    { ratio: 3 / 4, size: "768x1024" },
    { ratio: 7 / 3, size: "1680x720" },
    { ratio: 16 / 9, size: "1824x1024" },
    { ratio: 9 / 16, size: "1024x1824" },
    { ratio: 4 / 3, size: "1344x1024" },
    { ratio: 3 / 4, size: "1024x1344" },
    { ratio: 3 / 2, size: "1536x1024" },
    { ratio: 2 / 3, size: "1024x1536" },
    { ratio: 7 / 3, size: "1792x768" },
    { ratio: 3 / 7, size: "768x1792" },
    { ratio: 7 / 4, size: "1792x1024" },
    { ratio: 4 / 7, size: "1024x1792" },
  ],
  "2K": [
    { ratio: 1, size: "2048x2048" },
    { ratio: 3 / 2, size: "2048x1360" },
    { ratio: 2 / 3, size: "1360x2048" },
    { ratio: 16 / 9, size: "2048x1152" },
    { ratio: 9 / 16, size: "1152x2048" },
    { ratio: 4 / 3, size: "2048x1536" },
    { ratio: 3 / 4, size: "1536x2048" },
    { ratio: 21 / 9, size: "2048x896" },
    { ratio: 9 / 21, size: "896x2048" },
  ],
  "4K": [
    { ratio: 1, size: "2880x2880" },
    { ratio: 3 / 2, size: "3520x2336" },
    { ratio: 2 / 3, size: "2336x3520" },
    { ratio: 16 / 9, size: "3840x2160" },
    { ratio: 9 / 16, size: "2160x3840" },
    { ratio: 4 / 3, size: "3312x2480" },
    { ratio: 3 / 4, size: "2480x3312" },
    { ratio: 21 / 9, size: "3840x1648" },
    { ratio: 9 / 21, size: "1648x3840" },
  ],
} as const;

export type ChentuResolutionTier = keyof typeof CHENTU_SIZES_BY_TIER;

export function chentuResolutionTier(
  value: unknown,
): ChentuResolutionTier | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === "1K" || normalized === "2K" || normalized === "4K"
    ? normalized
    : undefined;
}

/** Maps a prompt/reference ratio to a documented or custom 辰途 K-tier size. */
export function chentuSizeForResolutionTier(
  tierValue: unknown,
  aspectRatio?: string,
): string | undefined {
  const tier = chentuResolutionTier(tierValue);
  if (!tier) return undefined;
  const candidates = CHENTU_SIZES_BY_TIER[tier];
  const requested = aspectRatio ? numericRatio(aspectRatio) : undefined;
  if (!requested)
    return candidates.find((candidate) => candidate.ratio === 1)?.size;
  const nearest = candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.ratio / requested));
    const candidateDistance = Math.abs(Math.log(candidate.ratio / requested));
    return candidateDistance < bestDistance ? candidate : best;
  });
  const nearestDistance = Math.abs(Math.log(nearest.ratio / requested));
  if (nearestDistance <= GPT_IMAGE_4K_CANONICAL_RATIO_TOLERANCE)
    return nearest.size;
  const limits = AUTO_TIER_CANVAS_LIMITS[tier];
  return customImageSizeForRatio(
    requested,
    limits.maxEdge,
    limits.maxPixels,
  );
}

const CYBERAFEI_4K_AUTO_SIZES = [
  { ratio: 1, size: "2160x2160" },
  { ratio: 16 / 9, size: "3840x2160" },
  { ratio: 9 / 16, size: "2160x3840" },
  { ratio: 4 / 3, size: "2880x2160" },
  { ratio: 3 / 4, size: "2160x2880" },
  { ratio: 3 / 2, size: "3248x2160" },
  { ratio: 2 / 3, size: "2160x3248" },
  { ratio: 21 / 9, size: "3840x1648" },
  // A-series portrait and landscape inputs that both Cyber Afei 4K model
  // names accepted during the 2026-08-03 paid verification run.
  { ratio: 70 / 99, size: "2416x3424" },
  { ratio: 99 / 70, size: "3424x2416" },
] as const;

const CYBERAFEI_4K_MIN_PIXELS = 655_360;
const CYBERAFEI_4K_MAX_PIXELS = 3840 * 2160;
const CYBERAFEI_4K_MAX_EDGE = 3840;

/**
 * Normalizes Cyber Afei's GPT Image 2 aliases to the upstream custom-size
 * contract: both edges are multiples of 16, the long edge is at most 3840,
 * the edge ratio is at most 3:1, and the total pixel count stays in range.
 */
export function cyberAfei4KValidSize(value: string): string | undefined {
  const match = /^(\d+)x(\d+)$/u.exec(value.trim());
  if (!match) return undefined;
  const sourceWidth = Number(match[1]);
  const sourceHeight = Number(match[2]);
  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  )
    return undefined;
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  const sourceShortEdge = Math.min(sourceWidth, sourceHeight);
  if (sourceLongEdge / sourceShortEdge > 3) return undefined;

  const sourcePixels = sourceWidth * sourceHeight;
  const minimumScale =
    sourcePixels < CYBERAFEI_4K_MIN_PIXELS
      ? Math.sqrt(CYBERAFEI_4K_MIN_PIXELS / sourcePixels)
      : 1;
  const scale = Math.min(
    minimumScale,
    CYBERAFEI_4K_MAX_EDGE / sourceLongEdge,
    Math.sqrt(CYBERAFEI_4K_MAX_PIXELS / sourcePixels),
  );
  let width = Math.max(16, Math.round((sourceWidth * scale) / 16) * 16);
  let height = Math.max(16, Math.round((sourceHeight * scale) / 16) * 16);
  width = Math.min(CYBERAFEI_4K_MAX_EDGE, width);
  height = Math.min(CYBERAFEI_4K_MAX_EDGE, height);

  while (width * height > CYBERAFEI_4K_MAX_PIXELS) {
    if (width >= height) width -= 16;
    else height -= 16;
  }
  if (
    width * height < CYBERAFEI_4K_MIN_PIXELS ||
    Math.max(width, height) / Math.min(width, height) > 3
  )
    return undefined;
  return `${width}x${height}`;
}

/** Maps a prompt/reference ratio to a tested or custom Cyber Afei 4K size. */
export function cyberAfei4KSizeForAspectRatio(
  value: string,
): string | undefined {
  const requested = numericRatio(value);
  if (!requested || requested < 0.1 || requested > 10) return undefined;
  const nearest = CYBERAFEI_4K_AUTO_SIZES.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.ratio / requested));
    const candidateDistance = Math.abs(Math.log(candidate.ratio / requested));
    return candidateDistance < bestDistance ? candidate : best;
  });
  const nearestDistance = Math.abs(Math.log(nearest.ratio / requested));
  return nearestDistance <= GPT_IMAGE_4K_CANONICAL_RATIO_TOLERANCE
    ? nearest.size
    : customImageSizeForRatio(
        requested,
        CYBERAFEI_4K_MAX_EDGE,
        CYBERAFEI_4K_MAX_PIXELS,
      );
}

/** Reads an explicit ratio from the prompt before orientation words. */
export function aspectRatioFromPrompt(prompt: string): string | undefined {
  const text = prompt.trim();
  if (!text) return undefined;

  // Accept both ordinary ratios (3:4) and explicit canvas ratios such as
  // 1175:1310. The surrounding digit lookarounds keep a larger dimension
  // from being split into a false partial match.
  const ratio = /(?<!\d)(\d{1,5})\s*[:：/／]\s*(\d{1,5})(?!\d)/u.exec(text);
  if (ratio) {
    const parsed = ratioFromParts(Number(ratio[1]), Number(ratio[2]));
    if (parsed) return parsed;
  }

  const dimensions = dimensionsFromPrompt(text);
  if (dimensions) {
    const [width, height] = dimensions.split("x").map(Number);
    const parsed = ratioFromParts(width!, height!);
    if (parsed) return parsed;
  }

  // ISO A-series paper sizes all use the same 1:√2 aspect ratio. Treat an
  // unqualified paper request as portrait, while preserving an explicit
  // landscape instruction. The provider adapter will snap this precise ratio
  // to the closest option supported by the selected model.
  if (/\bA(?:10|[0-9])\b/iu.test(text)) {
    return /(?:横屏|横版|横向|landscape|horizontal|wide)/iu.test(text)
      ? "99:70"
      : "70:99";
  }

  if (/(?:正方形|方形|square)/iu.test(text)) return "1:1";
  if (/(?:竖屏|竖版|纵向|人像|portrait|vertical)/iu.test(text)) return "9:16";
  if (/(?:横屏|横版|横向|风景|landscape|horizontal|wide)/iu.test(text))
    return "16:9";
  return undefined;
}
