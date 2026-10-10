import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";

const operations = ["image.generate", "image.edit"] as const;
const pixels = [
  ["1:1", "1024x1024", "2048x2048"], ["16:9", "1376x768", "1920x1080"],
  ["9:16", "768x1376", "1080x1920"], ["3:2", "1264x848", "1536x1024"],
  ["2:3", "848x1264", "1024x1536"], ["4:3", "1200x896", "1536x1152"],
  ["3:4", "896x1200", "1152x1536"], ["4:5", "928x1152", "1536x1920"],
  ["5:4", "1152x928", "1920x1536"], ["21:9", "1792x768", "2016x864"],
  ["9:21", "768x1792", "864x2016"],
] as const;

/** Exact Secure contract; other Seedream channels have different transports and sizes. */
export function secureSeedreamImageContract(
  connection: { provider: string; config: Readonly<Record<string, unknown>> },
  model: ModelDescriptor,
): ModelDescriptor {
  if (connection.provider !== "openai" || model.id !== "seedream-5.0-pro") return model;
  try {
    const url = new URL(String(connection.config.baseUrl ?? ""));
    if (url.protocol !== "https:" || url.hostname !== "token.secure-skill.com" || url.port || url.username || url.password ||
        url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return model;
  } catch { return model; }
  const parameters: ModelParameterDescriptor[] = [
    { key: "size", label: "分辨率", control: "dimensions", valueType: "string", default: "2048x2048", min: 768, max: 2048, step: 1,
      options: [1, 2].flatMap(tier => pixels.map(row => ({ value: row[tier]!, label: `${tier}K · ${row[0]} · ${row[tier]!.replace("x", " × ")}` }))), operations,
      description: "官方 1K / 2K 尺寸表；每边 768–2048 整像素，无 16 倍数限制。不支持 4K、auto 或 0。默认 2048 × 2048；旧显式 W/H 优先显示，修改尺寸后采用新值。" },
    { key: "width", label: "指定 W", control: "number", valueType: "integer", min: 768, max: 2048, step: 1, operations,
      description: "可选；必须与 H 同时填写。填写后覆盖尺寸预设，清除 W/H 后恢复预设。" },
    { key: "height", label: "指定 H", control: "number", valueType: "integer", min: 768, max: 2048, step: 1, operations,
      description: "可选；必须与 W 同时填写，范围 768–2048。" },
    { key: "n", label: "生成张数", control: "number", valueType: "integer", min: 1, max: 6, step: 1, default: 1, operations },
    { key: "strength", label: "参考图强度", control: "select", valueType: "string", operations: ["image.edit"],
      options: ["LOW", "MID", "HIGH"].map(value => ({ value, label: value })),
      description: "最多 10 张公网 HTTP(S) 参考图；不支持蒙版、透明选项或 base64 输入。" },
  ];
  const metadata = { ...model.metadata };
  for (const key of ["imageNativeResolutionParameter", "supportedOutputFormats", "imageOutputFormats", "imageOutputDimensions", "imageApproximateResolutions"])
    delete metadata[key];
  return { ...model, operations, parameters, inputKinds: ["text", "image", "image[]"], outputKinds: ["image", "image[]"],
    limits: { ...model.limits, maxInputImages: 10, maxOutputImages: 6 },
    metadata: { ...metadata, imageNativeParameterContract: true, imageNativeResolutionOptions: true,
      imageSupportedResolutions: ["1K", "2K"], imageNativeQualityOptions: true,
      imageAspectRatioSizes: Object.fromEntries(pixels.filter(row => ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9"].includes(row[0])).map(row => [row[0], row[2]])),
      imageParameterContract: "secure-seedream-5.0-pro", documentationUrl: "https://token.secure-skill.com/docs#seedream-5-image",
      contractCheckedAt: "2026-10-10T01:01:52.713Z", imageContractDocumentSha256: "5b1d940962aad3a8467e81339e33c2278b3c33f9c60cdac5d8ff586760278406",
      imageParameterContractNote: "提示词至少 3 个字符；默认 2K 方图。参考图只接受公网 URL，最多 10 张；输出编码由供应商决定，保留原文件。" } };
}
