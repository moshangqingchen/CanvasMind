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
  };
}

/** Original supplier bytes, not a PNG extension or a successful HTTP status.
 * Keep exact routes separate; success never proves a related model or group.
 */
export const VERIFIED_TRANSPARENT_IMAGES: readonly TransparentImageEvidence[] = [
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
export function verifiedTransparentImageEvidence(connection: ImageEditingConnection, model: string,
  parameters: Readonly<Record<string, unknown>> = {}): TransparentImageEvidence | undefined {
  const config = connection.config;
  if (config.supplierArchived === true || ["agent", "disabled"].includes(String(config.usage))) return undefined;
  let url: URL;
  try { url = new URL(String(config.baseUrl ?? "")); } catch { return undefined; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
      !/^(?:\/v1)?\/?$/u.test(url.pathname)) return undefined;
  const group = String(config.accountKeyGroup ?? config.modelGroup ?? "");
  // A key tied to a different group cannot inherit the displayed group's proof.
  if (config.accountKeyGroup !== undefined && config.modelGroup !== undefined && config.accountKeyGroup !== config.modelGroup)
    return undefined;
  return VERIFIED_TRANSPARENT_IMAGES.find(evidence => evidence.provider === connection.provider &&
    evidence.hostname === url.hostname && evidence.group === group && evidence.model === model &&
    Object.entries(evidence.selectors ?? {}).every(([key, value]) => parameters[key] === value));
}
