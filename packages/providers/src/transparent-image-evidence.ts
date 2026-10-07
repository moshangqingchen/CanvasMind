import type { ImageEditingConnection } from "./image-editing-capabilities.js";

export interface TransparentImageEvidence {
  readonly provider: string;
  readonly hostname: string;
  readonly group: string;
  readonly model: string;
  /** Only route selectors belong here; tested size/quality are recorded below. */
  readonly selectors?: Readonly<Partial<Record<"series" | "tier", string>>>;
  readonly transport: {
    readonly kind: "openai-images" | "saved-rest" | "pdog-async" | "pdog-sync" | "chuangxiang-images" | "cangyuan-images";
    readonly path: string;
    readonly method: "POST";
    readonly bodyMode: "json" | "multipart";
  };
  readonly checkedAt: string;
  readonly request: Readonly<Record<string, string | number | boolean>>;
  readonly output: {
    readonly width: number;
    readonly height: number;
    readonly format: "png";
    readonly fullyTransparentPixelRatio: number;
    readonly visualNotes?: string;
  };
}

type ImageEvidenceIdentity = Pick<TransparentImageEvidence, "provider" | "hostname" | "group" | "model" | "selectors">;

/** A measured failure of this exact route, not a permanent supplier capability claim.
 * Connection, quota and timeout errors are deliberately not eligible outcomes.
 */
export type FailedTransparentImageEvidence = ImageEvidenceIdentity &
  Pick<TransparentImageEvidence, "transport" | "checkedAt" | "request"> & (
    { readonly reason: "opaque-png"; readonly output: {
      readonly width: number; readonly height: number; readonly format: "png";
      readonly transparentPixels: 0; readonly sha256: string;
    } } |
    { readonly reason: "background-rejected"; readonly rejection: { readonly parameter: "background"; readonly message: string } }
  );

export const FAILED_TRANSPARENT_IMAGE_TESTS: readonly FailedTransparentImageEvidence[] = [
  // Original case 042: a PNG with no transparent pixels, despite the transparent request.
  {
    provider: "openai", hostname: "api.eaheng.com", group: "B4-GPT生图原生渠道V3（高质量）", model: "gpt-image-2.5",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { background: "transparent", n: 1, quality: "max", size: "3840x2160", output_format: "png" },
    reason: "opaque-png",
    output: { width: 3584, height: 2016, format: "png", transparentPixels: 0,
      sha256: "3fe934fe32643a339be1bb48298475bffd885226277060e73b2e35d4e9c8197e" },
  },
  // Incremental case 050: recovered the same succeeded task's original PNG, with no resubmission.
  {
    provider: "openai", hostname: "api.eaheng.com", group: "B4-GPT生图原生渠道V3（高质量）", model: "gpt-image-2.5-sunburst-high",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { background: "transparent", n: 1, quality: "high", size: "3840x2160", output_format: "png" },
    reason: "opaque-png",
    output: { width: 3840, height: 2160, format: "png", transparentPixels: 0,
      sha256: "b12bfcea0006cc18c28fbbd4a8b0c5ad7d75c3cdbe0ebb3c8961c040a0002c01" },
  },
];

/** Original supplier bytes, not a PNG extension or a successful HTTP status.
 * Keep exact routes separate; success never proves a related model or group.
 */
export const VERIFIED_TRANSPARENT_IMAGES: readonly TransparentImageEvidence[] = [
  // Incremental cases 025/026: visually verified alpha PNGs; the 2K request also returned 1254x1254.
  {
    provider: "rest", hostname: "api.3365api.cn", group: "image-2稳定生图", model: "gpt-image-2",
    transport: { kind: "saved-rest", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { size: "1024x1024", quality: "high", n: 1, response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.6493116763199865 },
  },
  {
    provider: "rest", hostname: "api.3365api.cn", group: "image-2稳定生图", model: "gpt-image-2-2K",
    transport: { kind: "saved-rest", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { size: "2048x2048", quality: "high", n: 1, response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.6450115610906344 },
  },
  // Incremental case 037: the 1K request returned a transparent 1254x1254 original.
  {
    provider: "openai", hostname: "tu.988236.xyz", group: "1k低价生图", model: "gpt-image-2.5",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.6457943830142269 },
  },
  // Incremental cases 067/068 support transparent PNG, with visible edge/background halos.
  {
    provider: "openai", hostname: "api.frimodel.com", group: "openai_official_外接", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { quality: "auto", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1024, height: 1024, format: "png", fullyTransparentPixelRatio: 0.6587533950805664,
      visualNotes: "透明背景已确认，主体边缘有明显棕橙色光晕；未验证精细抠图。" },
  },
  {
    provider: "openai", hostname: "api.frimodel.com", group: "openai_official_外接", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { quality: "auto", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1024, height: 1024, format: "png", fullyTransparentPixelRatio: 0.5629091262817383,
      visualNotes: "透明背景已确认，主体边缘有明显棕橙色光晕并保留白色地台；未验证精细抠图。" },
  },
  // Incremental cases 072/073: the 1K Web route returned transparent 1254x1254 originals.
  {
    provider: "openai", hostname: "api.frimodel.com", group: "gpt_image_web", model: "gpt-image-2-w",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.5822687972650199 },
  },
  {
    provider: "openai", hostname: "api.frimodel.com", group: "gpt_image_web", model: "gpt-image-2.5",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { quality: "auto", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.6558400677640164 },
  },
  // Incremental case 075: transparent AZ output with a visible warm edge halo.
  {
    provider: "openai", hostname: "api.frimodel.com", group: "gpt_image_az", model: "gpt-image-2-az",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1024, height: 1024, format: "png", fullyTransparentPixelRatio: 0.5938873291015625,
      visualNotes: "透明背景已确认，主体周围有明显暖色渐变光晕；未验证精细抠图。" },
  },
  // Incremental cases 083-086 use the root Images endpoint, without /v1.
  {
    provider: "openai", hostname: "api.hangzhale.com", group: "Image - 1k", model: "gpt-image-2",
    transport: { kind: "openai-images", path: "/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.620596547189345 },
  },
  {
    provider: "openai", hostname: "api.hangzhale.com", group: "Image - 1k", model: "gpt-image-2.5",
    transport: { kind: "openai-images", path: "/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.60423868501179 },
  },
  {
    provider: "openai", hostname: "api.hangzhale.com", group: "Image - 1k", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.6601859694909304 },
  },
  {
    provider: "openai", hostname: "api.hangzhale.com", group: "Image - 1k", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.6434452813198721 },
  },
  // Incremental cases 096/097 have real transparent backgrounds, with visible halos.
  {
    provider: "openai", hostname: "synoralink.com", group: "OAI官Key生图", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1024, height: 1024, format: "png", fullyTransparentPixelRatio: 0.7302055358886719,
      visualNotes: "透明背景已确认，主体边缘有明显棕橙色光晕；未验证精细抠图。" },
  },
  {
    provider: "openai", hostname: "synoralink.com", group: "OAI官Key生图", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", background: "transparent", output_format: "png" },
    output: { width: 1024, height: 1024, format: "png", fullyTransparentPixelRatio: 0.6101217269897461,
      visualNotes: "透明背景已确认，主体边缘有明显棕橙色光晕并保留白色地台；未验证精细抠图。" },
  },
  // Incremental case 103: the same task's original PNG was recovered without another generation.
  {
    provider: "openai", hostname: "tu.988236.xyz", group: "1k福利生图", model: "gpt-image-2-1k",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, quality: "high", size: "1024x1024", response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 1024, height: 1024, format: "png", fullyTransparentPixelRatio: 0.6566638946533203 },
  },
  // Incremental case 105: the captured AZ request did not contain a quality field.
  {
    provider: "openai", hostname: "tu.988236.xyz", group: "az渠道image系列token计费", model: "AZ-gpt-image-2",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-07",
    request: { n: 1, size: "1024x1024", response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 1024, height: 1024, format: "png", fullyTransparentPixelRatio: 0.6084737777709961,
      visualNotes: "透明背景已确认，主体周围有明显暖色渐变光晕并保留白色地台；未验证精细抠图。" },
  },
  {
    provider: "weai", hostname: "asian-acc.we-token.cc", group: "生图-openai-codex-token计费", model: "gpt-image-2",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", n: 1, background: "transparent", output_format: "png" },
    // Case 010's original PNG proves transparency, but did not match the requested 4K size.
    output: { width: 1254, height: 1254, format: "png", fullyTransparentPixelRatio: 0.4988120947577004 },
  },
  {
    provider: "weai", hostname: "asian-acc.we-token.cc", group: "AZURE-openai", model: "gpt-image-2",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "high", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7596883439429012 },
  },
  {
    provider: "openai", hostname: "api.mikoto.vip", group: "生图（2k4k 高质量）", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7473697916666666 },
  },
  {
    provider: "openai", hostname: "api.mikoto.vip", group: "生图（2k4k 高质量）", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.6989312065972222 },
  },
  {
    provider: "openai", hostname: "genimage.pro", group: "default", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.27542136863425926 },
  },
  {
    provider: "openai", hostname: "genimage.pro", group: "default", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.804551986882716 },
  },
  {
    provider: "openai", hostname: "asian-acc.we-token.cc", group: "生图-openai-adobe-image2.5专属", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7612307098765432 },
  },
  {
    provider: "openai", hostname: "asian-acc.we-token.cc", group: "生图-openai-adobe-image2.5专属", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.43652910397376543 },
  },
  {
    provider: "openai", hostname: "tu.988236.xyz", group: "image2.5全参", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7722561005015433 },
  },
  {
    provider: "openai", hostname: "ai.whyshy.cn", group: "【生图】image2/2.5-2K4K(原生)", model: "gpt-image-2.5",
    transport: { kind: "pdog-async", path: "/v1/images/generations/async", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7738758680555555 },
  },
  {
    provider: "openai", hostname: "ai.whyshy.cn", group: "【生图】image2/2.5-2K4K(原生)", model: "gpt-image-2.5-flare",
    transport: { kind: "pdog-async", path: "/v1/images/generations/async", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7832185570987654 },
  },
  {
    provider: "openai", hostname: "ai.whyshy.cn", group: "【生图】image2/2.5-2K4K(原生)", model: "gpt-image-2.5-sunburst",
    transport: { kind: "pdog-async", path: "/v1/images/generations/async", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7385221354166667 },
  },
  {
    provider: "openai", hostname: "tu.988236.xyz", group: "image2.5全参", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, response_format: "url", background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.6571404803240741 },
  },
  {
    provider: "openai", hostname: "synoralink.com", group: "高质量生图专线", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7653 },
  },
  {
    provider: "openai", hostname: "api.frimodel.com", group: "gpt_image_adobe", model: "gpt-image-2.5-flare-adobe",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7716325472608024 },
  },
  {
    provider: "openai", hostname: "api.frimodel.com", group: "gpt_image_adobe", model: "gpt-image-2.5-sunburst-adobe",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.7725411120756173 },
  },
  {
    provider: "openai", hostname: "genimage.pro", group: "gptResponseBase64", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.8007430314429013 },
  },
  {
    provider: "openai", hostname: "genimage.pro", group: "gptResponseBase64", model: "gpt-image-2.5-sunburst",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.017242356288580247 },
  },
  {
    provider: "openai", hostname: "synoralink.com", group: "高质量生图专线", model: "gpt-image-2.5-flare",
    transport: { kind: "openai-images", path: "/v1/images/generations", method: "POST", bodyMode: "json" },
    checkedAt: "2026-10-05",
    request: { size: "3840x2160", quality: "max", n: 1, background: "transparent", output_format: "png" },
    output: { width: 3840, height: 2160, format: "png", fullyTransparentPixelRatio: 0.8158786651234567 },
  },
];

/** Browser-safe identity matching shared by the mode picker and request adapter. */
function matchesTransparentImageEvidence(connection: ImageEditingConnection, model: string,
  parameters: Readonly<Record<string, unknown>>, evidence: ImageEvidenceIdentity): boolean {
  const config = connection.config;
  if (config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage))) return false;
  let url: URL;
  try { url = new URL(String(config.baseUrl ?? "")); } catch { return false; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
      !/^(?:\/v1)?\/?$/u.test(url.pathname)) return false;
  const group = String(config.accountKeyGroup ?? config.modelGroup ?? "");
  // A key tied to a different group cannot inherit the displayed group's proof.
  if (config.accountKeyGroup !== undefined && config.modelGroup !== undefined && config.accountKeyGroup !== config.modelGroup)
    return false;
  return evidence.provider === connection.provider &&
    evidence.hostname === url.hostname && evidence.group === group && evidence.model === model &&
    Object.entries(evidence.selectors ?? {}).every(([key, value]) => parameters[key] === value);
}

export function verifiedTransparentImageEvidence(connection: ImageEditingConnection, model: string,
  parameters: Readonly<Record<string, unknown>> = {}): TransparentImageEvidence | undefined {
  return VERIFIED_TRANSPARENT_IMAGES.find(evidence => matchesTransparentImageEvidence(connection, model, parameters, evidence));
}

export function failedTransparentImageEvidence(connection: ImageEditingConnection, model: string,
  parameters: Readonly<Record<string, unknown>> = {}): FailedTransparentImageEvidence | undefined {
  return FAILED_TRANSPARENT_IMAGE_TESTS.find(evidence => matchesTransparentImageEvidence(connection, model, parameters, evidence));
}

/** Only these two measured Images JSON paths may extend an existing contract. */
export function verifiedTransparentImageJsonEndpoint(connection: ImageEditingConnection, model: string,
  parameters: Readonly<Record<string, unknown>>, evidence: TransparentImageEvidence | undefined,
  kind: "openai-images" | "saved-rest"): string | undefined {
  if (!evidence || !matchesTransparentImageEvidence(connection, model, parameters, evidence) ||
      evidence.transport.kind !== kind || evidence.transport.method !== "POST" || evidence.transport.bodyMode !== "json" ||
      !["/v1/images/generations", "/images/generations"].includes(evidence.transport.path)) return undefined;
  return `${new URL(String(connection.config.baseUrl)).origin}${evidence.transport.path}`;
}
