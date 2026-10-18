/** Exact video-group /v1/models snapshot, cross-checked against the current
 * VideoApiDocsView-DUQJ-jyA.js guide. These are supplier declarations, not paid
 * generation results. Unknown and historical IDs retain their own contracts. */
export const CHUANGXIANG_VIDEO_CAPABILITY_SOURCE = {
  url: "https://vapi.chuangxiangai.asia/v1/models",
  sampledAt: "2026-10-18T00:28:15.223Z",
  docsUrl: "https://vapi.chuangxiangai.asia/ui-price-20260922/assets/VideoApiDocsView-DUQJ-jyA.js",
  docsSampledAt: "2026-10-18T00:32:19.320Z",
} as const;

export interface ChuangxiangVideoCapability {
  minDuration: number;
  maxDuration: number;
  resolutions: readonly string[];
  images: number;
  videos: number;
  audios: number;
  frames: boolean;
  durationOptions?: readonly number[];
}

const capability = (minDuration: number, maxDuration: number, resolutions: readonly string[], images: number,
  videos = 0, audios = 0, frames = false, durationOptions?: readonly number[]): ChuangxiangVideoCapability =>
  ({ minDuration, maxDuration, resolutions, images, videos, audios, frames, ...(durationOptions ? { durationOptions } : {}) });
const current: Readonly<Record<string, ChuangxiangVideoCapability>> = {
  "grok-imagine-video": capability(1, 15, ["480p", "720p"], 1),
  "grok-imagine-video-1.5": capability(1, 15, ["480p", "720p", "1080p"], 7),
  "gv3-grok-video-1.5": capability(3, 15, ["720p"], 7),
  "gv4-grok-imagine-video-1.5": capability(6, 15, ["480p", "720p"], 7),
  "happyhorse-1.1": capability(3, 15, ["720p", "1080p"], 9),
  "kling-3.0": capability(3, 15, ["720p"], 1),
  "kling-3.0-pro": capability(3, 15, ["720p"], 4),
  "mm3-minimax-h3-2k": capability(15, 15, ["2k"], 9, 3, 3),
  "mm4-minimax-h3-2k": capability(5, 15, ["2k"], 9, 3, 3),
  "niulai-pro": capability(4, 15, ["768p", "2k"], 9, 3, 3, true),
  "omni-fast": capability(1, 15, ["720p"], 5, 0, 0, true),
  "omni-fast-no-water": capability(1, 15, ["720p"], 5, 0, 0, true),
  "omni-v2v": capability(1, 15, ["720p"], 5, 2),
  "omni-v2v-no-water": capability(1, 15, ["720p"], 5, 2),
  "sd10-seedance-2.5": capability(30, 30, ["720p"], 30),
  "sd13-seedance-2.0": capability(4, 15, ["480p", "720p", "1080p", "4k"], 9, 3),
  "sd13-seedance-2.0-fast": capability(4, 15, ["480p", "720p"], 9, 3),
  "sd13-seedance-2.0-mini": capability(4, 15, ["480p", "720p"], 9, 3),
  "sd13-seedance-2.5": capability(4, 30, ["480p", "720p"], 30, 10),
  "sd14-seedance-2.0": capability(4, 15, ["720p"], 9, 3, 3, true),
  "sd16-seedance-2.0": capability(4, 15, ["480p", "720p", "1080p", "4k"], 9, 3, 3, true),
  "sd16-seedance-2.0-fast": capability(4, 15, ["480p", "720p"], 9, 3, 3, true),
  "sd16-seedance-2.0-mini": capability(4, 15, ["480p", "720p"], 9, 3, 3, true),
  "sd17-seedance-2.0": capability(5, 15, ["720p"], 9, 0, 3),
  "sd17-seedance-2.0-2": capability(5, 15, ["720p"], 9, 0, 3),
  "sd17-seedance-2.0-3": capability(5, 15, ["720p"], 9, 0, 0, false, [5, 10, 15]),
  "sd17-seedance-2.5": capability(5, 30, ["720p"], 30, 10),
  "sd17-seedance-2.5-2": capability(10, 30, ["720p"], 30, 10, 10),
  "sd17-seedance-2.5-3": capability(30, 30, ["720p"], 9),
  "sd8-seedance-2.5-s": capability(30, 30, ["720p"], 30, 10, 10),
};

export function chuangxiangVideoCapability(id: string): ChuangxiangVideoCapability | undefined {
  return Object.hasOwn(current, id) ? current[id] : undefined;
}
export const CHUANGXIANG_CURRENT_VIDEO_IDS = Object.keys(current);
