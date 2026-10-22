/** Current exact-model plaza rows; generic example ranges are not model limits. */
const common = [
  { name: "model", type: "string", required: true }, { name: "prompt", type: "string", required: true },
  { name: "ratio", type: "enum", default: "16:9", range: "16:9, 9:16, 1:1" },
  { name: "images", type: "array" }, { name: "videos", type: "array" }, { name: "audios", type: "array" }, { name: "materials", type: "array" },
];
export const JIASU_VIDEO_UPDATE_20261021 = [
  { id: "sd-2.5-J3-doubao", description: "720p:4–30 秒，30 图、10 视频、10 音频；素材总大小不超过100MiB；1080p:4–30 秒，9图、3音频。",
    apiParameters: [...common, { name: "duration", type: "integer", required: true, default: "5", range: "1 ~ 60" }, { name: "resolution", type: "enum", default: "720p", range: "720p, 1080p" }] },
  { id: "sd-2.5-j2-V2", description: "参考30图片 10视频 10音频 720P 原生过真人 5-30秒",
    apiParameters: [{ name: "resolution", type: "enum", default: "720p", range: "720p" }] },
  { id: "minimax-h3", description: "9图3视频3音频，（音视频合计时长不超过15秒），原生过真人；768自部署，30秒，0.05/s",
    apiParameters: [...common.filter(p => p.name !== "ratio" && p.name !== "videos"),
      { name: "duration", type: "integer", required: true, default: "30", range: "5-30", description: "视频时长（秒），4–15 的整数。客户端未传时长时使用此默认值。" },
      { name: "ratio", type: "enum", default: "16:9", range: "9:16, 1:1, 3:4, 4:3, 16:9" },
      { name: "resolution", type: "enum", required: true, default: "768p", range: "768p" },
      { name: "videos", type: "array", description: "参考视频最多3个，多条合计不超过15秒；图片+视频+音频合计最多10个；参考视频必须带duration_seconds实际时长。" }] },
  { id: "sd-2.0-mini-503-J3", description: "5图3音频 支持人脸 480p",
    apiParameters: [{ name: "resolution", type: "enum", default: "720p", range: "720p", description: "输出分辨率预设" }] },
];
