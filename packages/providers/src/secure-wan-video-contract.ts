/** Secure's standard WAN contract, re-read from its current DocsView on 2026-10-14.
 * The standard endpoint defaults to 16:9; DashScope's adaptive default does not
 * apply to this transport. Keep both ratio aliases in the shared normalizer.
 */
export const SECURE_WAN_VIDEO_CONTRACT = {
  checkedAt: "2026-10-14",
  min: 2, max: 30, images: 10, videos: 5, audios: 5,
  resolutions: ["480P", "720P", "1080P"], defaultResolution: "720P",
  ratios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  defaultRatio: "16:9", ratioField: "ratio", freeRatio: false,
  frames: "wan-first", imageField: "media", videoField: "media", audioField: "media", httpsOnly: true,
  submitPath: "/v1/videos/generations", pollPath: "/v1/videos/tasks/{taskId}",
  outputPaths: ["$.video_url", "$.url", "$.download_url", "$.output.video_url", "$.data.video_url", "$.result.video_url"],
  note: "标准协议支持首帧、普通参考图、视频和音频；只接受公网 HTTPS。比例支持 adaptive / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16，默认 16:9；首帧可选 adaptive。标准协议不支持智能时长 -1。当前分组58新增参考视频计费说明，但未公布其时长与金额计算规则；带参考视频时不推算总价。",
} as const;
