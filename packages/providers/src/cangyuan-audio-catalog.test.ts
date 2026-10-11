import { describe, expect, it } from "vitest";
import { normalizeCangyuanAudioCatalogModel } from "./cangyuan-audio-catalog.js";
import { parseSupplierCatalog } from "./supplier-catalog.js";

const site = "https://ai.cangyuansuanli.cn";
const raw = [
  { model_name: "gemini-tts", description: "文字转语音。按输入字符计费，不按成片时长。", supported_endpoint_types: ["openai-speech"],
    quota_type: 0, model_ratio: 15, completion_ratio: 4, audio_completion_ratio: 0, model_price: 0,
    enable_groups: ["AUDIO", "全模型-无claude/gpt"], speech_ui_params: { apiMode: "speech-sync", id: "gemini-tts" } },
  { model_name: "gemini-stt", description: "语音转文字。按音频时长计费。", supported_endpoint_types: ["openai"],
    quota_type: 0, model_ratio: 6, completion_ratio: 4, model_price: 0,
    enable_groups: ["AUDIO", "全模型-无claude/gpt"], speech_ui_params: { apiMode: "speech-sync", id: "gemini-stt" } },
];
const payload = { data: raw, group_ratio: { AUDIO: 1, "全模型-无claude/gpt": 1 }, usable_group: { AUDIO: "音频", "全模型-无claude/gpt": "全模型" } };

describe("exact Cangyuan documentary audio catalog", () => {
  it("ingests four official group/full-ID rows without treating either sync audio model as a chat or runnable operation", () => {
    const catalog = parseSupplierCatalog(payload, { supplierSiteUrl: site, currency: "CNY" });
    expect(catalog.groups).toHaveLength(2);
    for (const group of catalog.groups) {
      const tts = group.models.find(model => model.id === "gemini-tts")!;
      const stt = group.models.find(model => model.id === "gemini-stt")!;
      expect(tts).toMatchObject({ capability: "other", protocol: "unknown", operations: [], inputKinds: ["text"], outputKinds: ["audio"],
        priceLabel: "输入 ¥30/1M · 输出 ¥120/1M", metadata: { endpointTypes: ["openai-speech"], cangyuanAudioBillingBasis: "input-character",
          cangyuanAudioRequest: { method: "POST", path: "/v1/audio/speech", bodyMode: "json", synchronous: true, polling: false, response: "original-audio-bytes" },
          cangyuanAudioRawBillingValues: { model_ratio: 15, completion_ratio: 4, audio_completion_ratio: 0 } },
        parameters: expect.arrayContaining([{ key: "speed", label: "语速", control: "number", valueType: "number", min: .25, max: 4, default: 1 }]) });
      expect(stt).toMatchObject({ capability: "other", protocol: "unknown", operations: [], inputKinds: ["audio"], outputKinds: ["text"],
        priceLabel: "输入 ¥12/1M · 输出 ¥48/1M", metadata: { endpointTypes: ["openai"], cangyuanAudioBillingBasis: "audio-duration",
          cangyuanAudioRequest: { method: "POST", path: "/v1/audio/transcriptions", bodyMode: "multipart", synchronous: true, polling: false, response: "json-or-text" },
          cangyuanAudioRawSpeechUiParams: raw[1]!.speech_ui_params } });
      expect(group.models.filter(model => model.capability === "chat")).toEqual([]);
    }
  });
  it("preserves published original formats/voices and open language hints without inserting a default voice or language", () => {
    const tts = normalizeCangyuanAudioCatalogModel({ id: "gemini-tts", capability: "chat", metadata: { endpointTypes: ["openai-speech"] } }, site, "AUDIO") as unknown as { parameters: Array<{ key: string; options?: Array<{ value: string }>; default?: unknown; allowCustomValue?: boolean }> };
    expect(tts.parameters.find(field => field.key === "voice")?.options?.map(option => option.value)).toEqual(["Capella", "Ursa", "Vega", "Eclipse", "Lyra", "Orbit", "Dipper", "Nova", "Pegasus", "alloy", "echo", "shimmer", "onyx"]);
    expect(tts.parameters.find(field => field.key === "voice")?.default).toBeUndefined();
    expect(tts.parameters.find(field => field.key === "response_format")?.options?.map(option => option.value)).toEqual(["mp3", "opus", "aac", "flac", "wav", "pcm"]);
    const stt = normalizeCangyuanAudioCatalogModel({ id: "gemini-stt" }, site, "AUDIO") as unknown as typeof tts;
    expect(stt.parameters.find(field => field.key === "language")).toMatchObject({ allowCustomValue: true });
    expect(stt.parameters.find(field => field.key === "language")?.default).toBeUndefined();
    expect(stt.parameters.find(field => field.key === "response_format")?.options?.map(option => option.value)).toEqual(["json", "text", "verbose_json"]);
  });
  it.each(["https://other.invalid", "https://api.cangyuansuanli.cn", "http://ai.cangyuansuanli.cn", "https://ai.cangyuansuanli.cn.evil.invalid", "https://user@ai.cangyuansuanli.cn", "https://ai.cangyuansuanli.cn/?token=x"])("does not attach these source-specific audio fields to %s", source => {
    const model = { id: "gemini-tts", capability: "chat", priceLabel: "raw", metadata: { source: "catalog" } };
    expect(normalizeCangyuanAudioCatalogModel(model, source, "AUDIO")).toBe(model);
  });
  it("preserves sibling IDs, other groups, manual and paid contracts, existing pricing, and repeated projection idempotence", () => {
    for (const model of [{ id: "gemini-tts-other" }, { id: "gemini-tts", metadata: { source: "manual" } },
      { id: "gemini-stt", metadata: { source: "paid-test" } }, { id: "gemini-stt", metadata: { protocolEvidence: "paid-test" } }])
      expect(normalizeCangyuanAudioCatalogModel(model, site, "AUDIO")).toBe(model);
    const model = { id: "gemini-tts", priceLabel: "retained", pricing: { inputPerMillion: 30, outputPerMillion: 120 }, metadata: { endpointTypes: ["openai-speech"] } };
    expect(normalizeCangyuanAudioCatalogModel(model, site, "another-group")).toBe(model);
    const normalized = normalizeCangyuanAudioCatalogModel(model, site, "AUDIO");
    expect(normalized.pricing).toBe(model.pricing);
    expect(normalized.priceLabel).toBe(model.priceLabel);
    expect(normalizeCangyuanAudioCatalogModel(normalized, site, "AUDIO")).toEqual(normalized);
    expect(model).not.toHaveProperty("parameters");
  });
});
