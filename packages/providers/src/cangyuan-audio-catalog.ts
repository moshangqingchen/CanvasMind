import type { ModelParameterDescriptor } from "./contracts.js";

type CatalogRow = { id: string; metadata?: Readonly<Record<string, unknown>> | undefined };

/** Exact documentary projection only; this does not add an audio run operation. */
export function normalizeCangyuanAudioCatalogModel<T extends CatalogRow>(
  model: T,
  sourceUrl: string | undefined,
  group: string | undefined,
  rawPublication?: unknown,
): T {
  let url: URL;
  try { url = new URL(sourceUrl ?? ""); } catch { return model; }
  if (url.origin !== "https://ai.cangyuansuanli.cn" || url.username || url.password || url.search || url.hash ||
    !["AUDIO", "全模型-无claude/gpt"].includes(group ?? "") ||
    !["gemini-tts", "gemini-stt"].includes(model.id) ||
    ["manual", "paid-test"].includes(String(model.metadata?.source)) || model.metadata?.protocolEvidence === "paid-test") return model;
  const tts = model.id === "gemini-tts";
  const formats = tts ? ["mp3", "opus", "aac", "flac", "wav", "pcm"] : ["json", "text", "verbose_json"];
  const option = (value: string) => ({ label: value, value });
  const parameters: ModelParameterDescriptor[] = [
    { key: "model", label: "完整型号", control: "select", valueType: "string", required: true, default: model.id, options: [option(model.id)] },
    tts ? { key: "input", label: "朗读文本", control: "text", valueType: "string", required: true } :
      { key: "file", label: "音频文件", control: "text", valueType: "string", required: true, description: "multipart 字段名 file" },
    ...(tts ? [{ key: "voice", label: "音色", control: "select" as const, valueType: "string" as const,
      options: ["Capella", "Ursa", "Vega", "Eclipse", "Lyra", "Orbit", "Dipper", "Nova", "Pegasus", "alloy", "echo", "shimmer", "onyx"].map(option),
      description: "省略时由服务端选择音色" }] :
      [{ key: "language", label: "语种", control: "text" as const, valueType: "string" as const, allowCustomValue: true,
        description: "可选语种提示；zh、en、ja 是示例，省略时自动识别" }]),
    { key: "response_format", label: "返回格式", control: "select", valueType: "string", default: tts ? "mp3" : "json", options: formats.map(option) },
    ...(tts ? [{ key: "speed", label: "语速", control: "number" as const, valueType: "number" as const, min: .25, max: 4, default: 1 }] : []),
  ];
  const raw = rawPublication && typeof rawPublication === "object" && !Array.isArray(rawPublication)
    ? rawPublication as Record<string, unknown> : undefined;
  return {
    ...model,
    capability: "other",
    protocol: "unknown",
    operations: [],
    inputKinds: [tts ? "text" : "audio"],
    outputKinds: [tts ? "audio" : "text"],
    parameters,
    metadata: {
      ...model.metadata,
      catalogCapability: "other",
      inputKindsSource: "declared",
      outputKindsSource: "declared",
      documentationUrl: `https://ai.cangyuansuanli.cn/docs-static/models/${model.id}.json`,
      cangyuanAudioCatalogContract: 1,
      cangyuanAudioDocumentSha256: tts ? "2363f9c6a34967ec7c1c7584eac4003b3fd4e6972ae86a24f4f841853a6fceea" : "a4025fec465040b0d4efd381918d32ae3ad72a6790761910bc48ae91dcae48ae",
      cangyuanAudioDocumentCheckedAt: "2026-10-11T09:52:44.841Z",
      cangyuanAudioRequest: { method: "POST", path: tts ? "/v1/audio/speech" : "/v1/audio/transcriptions",
        bodyMode: tts ? "json" : "multipart", fields: parameters.map(parameter => parameter.key), synchronous: true, polling: false,
        response: tts ? "original-audio-bytes" : "json-or-text" },
      cangyuanAudioBillingBasis: tts ? "input-character" : "audio-duration",
      cangyuanAudioBillingEvidence: "Official description gives a billing basis; directory Token-style ratios/labels are retained separately and do not publish an absolute character/duration conversion.",
      ...(raw?.speech_ui_params ? { cangyuanAudioRawSpeechUiParams: raw.speech_ui_params } : {}),
      ...(typeof raw?.description === "string" ? { cangyuanAudioRawDescription: raw.description } : {}),
      ...(raw ? { cangyuanAudioRawBillingValues: Object.fromEntries(["quota_type", "model_ratio", "completion_ratio", "audio_completion_ratio", "model_price"]
        .filter(key => raw[key] !== undefined).map(key => [key, raw[key]])) } : {}),
    },
  };
}
