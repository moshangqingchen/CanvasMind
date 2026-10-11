import type { ModelParameterOption, ProviderAssetInput } from "./contracts.js";
import type { ImageEditingConnection } from "./image-editing-capabilities.js";

export const MIKOTO_IMAGE_DOCS = "https://api.mikoto.vip/openai-image-4k-2k-guide.html";
export const MIKOTO_GPT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
// These are this guide's examples, not an inferred alignment or complete size range.
const dimensions = [
  ["1:1", "2160x2160", "1440x1440"], ["16:9", "3840x2160", "2560x1440"],
  ["9:16", "2160x3840", "1152x2048"], ["4:3", "2880x2160", "1920x1440"],
  ["3:4", "2160x2880", "1440x1920"], ["3:2", "3240x2160", "2160x1440"],
  ["2:3", "2160x3240", "1440x2160"], ["21:9", "3840x1646", "2560x1097"],
] as const;
export const MIKOTO_GPT_IMAGE_SIZES: readonly ModelParameterOption[] = [
  { label: "自动", value: "auto" },
  { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
  ...(["2K", "4K"] as const).flatMap(tier => dimensions.map(([ratio, fourK, twoK]) => {
    const size = tier === "4K" ? fourK : twoK;
    return { label: `${tier} · ${ratio} · ${size.replace("x", " × ")}`, value: size };
  })),
];

export function isMikotoGptImage(connection: ImageEditingConnection, model: string): boolean {
  if (!["openai", "rest"].includes(connection.provider) || model !== "gpt-image-2") return false;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    return url.protocol === "https:" && url.hostname === "api.mikoto.vip" && !url.port && !url.username && !url.password &&
      !url.search && !url.hash && /^(?:\/v1)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

/** All reference URLs remain in their original order and are sent without a download/re-encode. */
export function mikotoUrlImageReferences(assets: readonly ProviderAssetInput[]): { image_url: string }[] | undefined {
  if (!assets.length || assets.some(asset => asset.kind !== "image" || asset.role === "mask")) return;
  const result: { image_url: string }[] = [];
  for (const asset of assets) {
    if (typeof asset.url !== "string") return;
    try {
      const url = new URL(asset.url.trim());
      if (!/^https?:$/u.test(url.protocol) || url.username || url.password) return;
      result.push({ image_url: asset.url.trim() });
    } catch { return; }
  }
  return result;
}
