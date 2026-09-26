import { createHash } from "node:crypto";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import type { DirectorModelCapabilities, DirectorProtocol } from "@super-canvas/director";
import type { ModelDescriptor } from "@super-canvas/providers";

export type AgentCapabilitySource = "live" | "channel-verification" | "provider-catalog" | "model-family" | "official-model" | "manual" | "default" | "adapter" | "unknown";
export type AgentInputStatus = "supported" | "unsupported" | "assumed" | "unknown";
export interface AgentReasoningOption { value: string; label: string }
export interface AgentInputLimits { maxImages?: number; maxVideos?: number; maxAudios?: number; maxAssets?: number }
type CapabilityFlags = Partial<Pick<DirectorModelCapabilities, "text" | "imageInput" | "audioInput" | "videoInput" | "structuredOutput" | "toolCalling" | "reasoning">>;
export const agentRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** A capability result is valid only for this exact credential and supplier source. */
export function agentModelEvidenceFingerprint(connection: ProviderConnectionRecord): string {
  const config = connection.config;
  return createHash("sha256").update(JSON.stringify([
    connection.id, connection.provider, connection.encryptedSecret, config.supplierId, config.supplierSourceId,
    config.baseUrl, config.modelGroup, config.protocol, config.directorProtocol, config.directorHeaders,
  ])).digest("hex");
}

export function createAgentModelEvidence(connection: ProviderConnectionRecord, input: {
  modelId: string; protocol?: DirectorProtocol; capabilities: CapabilityFlags;
  reasoningOptions?: AgentReasoningOption[]; probedAt?: string;
}) {
  return {
    fingerprint: agentModelEvidenceFingerprint(connection),
    modelId: input.modelId,
    ...(input.protocol ? { protocol: input.protocol } : {}),
    capabilities: { ...input.capabilities },
    ...(input.reasoningOptions ? { reasoningOptions: input.reasoningOptions } : {}),
    probedAt: input.probedAt ?? new Date().toISOString(),
  };
}

function scopedRecord(connection: ProviderConnectionRecord, field: string, modelId: string) {
  const record = agentRecord(agentRecord(connection.config[field])[modelId]);
  return record.fingerprint === agentModelEvidenceFingerprint(connection) &&
    (record.modelId === undefined || record.modelId === modelId) ? record : {};
}

/** Narrow, recorded channel verification; never infer another reseller's behavior. */
function verifiedChannel(connection: ProviderConnectionRecord, modelId: string): {
  protocol?: DirectorProtocol; capabilities?: CapabilityFlags; reasoningOptions?: AgentReasoningOption[];
} {
  let url: URL;
  try { url = new URL(String(connection.config.baseUrl ?? "")); } catch { return {}; }
  if (url.protocol === "https:" && url.host === "ai.cangyuansuanli.cn" &&
    ["", "/", "/v1", "/v1/"].includes(url.pathname) && !url.search && !url.username && !url.password &&
    connection.config.modelGroup === "LLM-GPT-plus") {
    if (modelId === "gpt-5.5") {
      // Only text Responses was verified for this model on 2026-09-22.
      return { protocol: "openai-responses", capabilities: { text: true } };
    }
    // Responses text, image understanding, high and xhigh were verified on
    // 2026-09-22. Chat Completions returned only usage and [DONE] (HTTP 200).
    if (modelId === "gpt-6-astra")
      return { protocol: "openai-responses", capabilities: { text: true, imageInput: true, reasoning: true },
        reasoningOptions: [{ value: "high", label: "高" }, { value: "xhigh", label: "超高" }] };
  }
  return {};
}

export function normalizeAgentProtocol(value: unknown): DirectorProtocol | undefined {
  if (value === "responses") return "openai-responses";
  if (value === "chat-completions") return "openai-chat-completions";
  if (value === "gemini-generate-content" || value === "gemini") return "google-generate-content";
  return typeof value === "string" && ["openai-responses", "openai-chat-completions", "anthropic-messages", "google-generate-content", "xai-responses", "generic-openai-compatible"].includes(value)
    ? value as DirectorProtocol : undefined;
}

export function modelAgentProtocol(connection: ProviderConnectionRecord, modelId: string, model?: ModelDescriptor): DirectorProtocol {
  const evidence = scopedRecord(connection, "agentModelEvidence", modelId);
  const runtime = scopedRecord(connection, "agentRuntimeProfiles", modelId);
  const configured = agentRecord(agentRecord(connection.config.agentModelCapabilities)[modelId]);
  const manual = (Array.isArray(connection.config.manualModels) ? connection.config.manualModels : [])
    .map(agentRecord).find(entry => entry.id === modelId && entry.capability === "chat");
  for (const value of [runtime.protocol, evidence.protocol, verifiedChannel(connection, modelId).protocol, model?.metadata?.agentProtocol,
    model?.metadata?.protocol, configured.protocol, manual?.protocol,
    connection.config.directorProtocol, connection.config.protocol]) {
    const protocol = normalizeAgentProtocol(value);
    if (protocol) return protocol;
  }
  const base = String(connection.config.baseUrl ?? "");
  if (/^https:\/\/api\.anthropic\.com(?:\/|$)/u.test(base)) return "anthropic-messages";
  if (/^https:\/\/generativelanguage\.googleapis\.com(?:\/|$)/u.test(base)) return "google-generate-content";
  // Use the recommended Responses transport only when no connection, supplier,
  // or current-Key evidence declared a protocol for this exact official model.
  const officialId = discoveredOfficialModel(connection, model)?.officialModelId ?? modelId;
  if (OFFICIAL_REASONING_OPTIONS[OFFICIAL_REASONING_ALIASES[officialId] ?? officialId]) return "openai-responses";
  if (CLAUDE_REASONING_OPTIONS[officialId]) return "anthropic-messages";
  if (GEMINI_REASONING_OPTIONS[officialId]) return "google-generate-content";
  return "openai-chat-completions";
}

// Official text/audio chat models and snapshots, checked 2026-09-22:
// https://developers.openai.com/api/docs/models/gpt-4o-audio-preview
const OFFICIAL_AUDIO_CHAT_MODELS = new Set([
  "gpt-4o-audio-preview", "gpt-4o-audio-preview-2025-06-03",
  "gpt-4o-audio-preview-2024-12-17", "gpt-4o-audio-preview-2024-10-01",
]);

export function isAgentTextModel(model: ModelDescriptor): boolean {
  if (model.operations.some(operation => operation.startsWith("image.") || operation.startsWith("video."))) {
    // A declared dual-output model may still support normal conversations.
    return model.outputKinds?.includes("text") === true && model.metadata?.outputKindsSource === "declared";
  }
  if (model.outputKinds?.length && !model.outputKinds.includes("text")) return false;
  const kind = String(model.metadata?.modelKind ?? "");
  if (/embedding|rerank|moderation|transcri|speech|tts|whisper/iu.test(`${model.id} ${kind}`)) return false;
  if (/(?:^|[-_])midjourney(?:[-_]|$)/iu.test(model.id) && model.metadata?.outputKindsSource !== "declared") return false;
  if (OFFICIAL_AUDIO_CHAT_MODELS.has(model.id)) return true;
  if (model.metadata?.outputKindsSource === "declared" && model.outputKinds?.includes("text") &&
    model.inputKinds?.some(value => value === "audio" || value === "audio[]")) return true;
  return !/(?:^|[-_])audio(?:[-_]|$)/iu.test(`${model.id} ${kind}`);
}

export function declaredAgentFlags(model?: ModelDescriptor): CapabilityFlags {
  if (!model) return {};
  const metadata = agentRecord(model.metadata);
  const result: Record<string, boolean> = {};
  const declared = agentRecord(metadata.agentCapabilities);
  const aliases: Record<string, string[]> = {
    imageInput: ["imageInput", "image_input", "vision", "supports_vision"],
    audioInput: ["audioInput", "audio_input"], videoInput: ["videoInput", "video_input"],
    structuredOutput: ["structuredOutput", "structured_output", "structured_outputs"],
    toolCalling: ["toolCalling", "tool_calling"], reasoning: ["reasoning", "supportsReasoning", "supports_reasoning"],
  };
  for (const [key, names] of Object.entries(aliases)) {
    const value = [declared, metadata].flatMap(record => names.map(name => record[name])).find(value => typeof value === "boolean");
    if (typeof value === "boolean") result[key] = value;
  }
  for (const kind of ["image", "audio", "video"] as const) {
    const limit = model.limits?.[({ image: "maxInputImages", audio: "maxInputAudios", video: "maxInputVideos" } as const)[kind]];
    if (limit === 0) { result[`${kind}Input`] = false; continue; }
    // Old scans assigned [text] to every LLM. Absence is not a negative fact.
    if (typeof result[`${kind}Input`] === "boolean") continue;
    if (model.inputKinds?.some(value => value === kind || value === `${kind}[]`)) result[`${kind}Input`] = true;
    else if (metadata.inputKindsSource === "declared") result[`${kind}Input`] = false;
    else if (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0) result[`${kind}Input`] = true;
  }
  return result;
}

function familyFacts(modelId: string): CapabilityFlags {
  // Limited established families; never treat a future model name as live proof.
  if (/^(?:gpt-4o(?:-mini)?|gpt-4\.1(?:-mini|-nano)?)(?:-\d{4}-\d{2}-\d{2})?$/iu.test(modelId)) return { imageInput: true };
  if (/^o[34](?:-mini)?(?:-\d{4}-\d{2}-\d{2})?$/iu.test(modelId)) return { imageInput: true, reasoning: true };
  return {};
}

const AUTO: AgentReasoningOption = { value: "auto", label: "自动" };
const LABELS: Record<string, string> = { none: "无", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "超高", max: "极限", ultra: "Ultra" };
// Exact official model families only. Provider declarations and current-Key
// evidence remain separate; a documented fallback is never a channel probe.
const OFFICIAL_REASONING_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-6-luna": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.6": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-terra": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-luna": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.5": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.4": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.4-mini": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.2": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.2-pro": ["medium", "high", "xhigh"],
};
// Only snapshots explicitly listed on the corresponding official model page.
const OFFICIAL_REASONING_ALIASES: Readonly<Record<string, string>> = {
  "gpt-5.6": "gpt-5.6-sol",
  "gpt-5.5-2026-04-23": "gpt-5.5",
  "gpt-5.4-2026-03-05": "gpt-5.4",
  "gpt-5.4-mini-2026-03-17": "gpt-5.4-mini",
  "gpt-5.2-2025-12-11": "gpt-5.2",
  "gpt-5.2-pro-2025-12-11": "gpt-5.2-pro",
  "claude-opus-4-5-20251101": "claude-opus-4-5",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-5",
};
const CLAUDE_REASONING_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  // These models support thinking budgets, but not the enumerated effort parameter.
  "claude-haiku-4-5": [],
  "claude-sonnet-4-5": [],
  "claude-opus-4-5": ["low", "medium", "high"],
  "claude-opus-4-6": ["low", "medium", "high", "max"],
  "claude-sonnet-4-6": ["low", "medium", "high", "max"],
  "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-8": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5-1": ["low", "medium", "high", "xhigh", "max"],
};
const GEMINI_REASONING_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "gemini-3-pro-preview": ["low", "high"],
  "gemini-3.1-pro-preview": ["low", "medium", "high"],
  "gemini-3-flash-preview": ["minimal", "low", "medium", "high"],
  "gemini-3.5-flash": ["minimal", "low", "medium", "high"],
};
function officialReasoningProfile(modelId: string) {
  const canonicalModel = OFFICIAL_REASONING_ALIASES[modelId] ?? (modelId.startsWith("models/gemini-") ? modelId.slice(7) : modelId);
  const options = OFFICIAL_REASONING_OPTIONS[canonicalModel] ?? CLAUDE_REASONING_OPTIONS[canonicalModel] ?? GEMINI_REASONING_OPTIONS[canonicalModel];
  if (!options) return undefined;
  const sourceUrl = OFFICIAL_REASONING_OPTIONS[canonicalModel] ? `https://developers.openai.com/api/docs/models/${canonicalModel}` :
    CLAUDE_REASONING_OPTIONS[canonicalModel] ? "https://platform.claude.com/docs/en/build-with-claude/effort" :
      canonicalModel === "gemini-3-pro-preview" ? "https://ai.google.dev/gemini-api/docs/thinking" : "https://ai.google.dev/gemini-api/docs/generate-content/thinking";
  const checkedAt = CLAUDE_REASONING_OPTIONS[canonicalModel] ? "2026-09-24"
    : ["gpt-6-sol", "gpt-6-luna"].includes(canonicalModel) ? "2026-09-23" : "2026-09-22";
  return { options, sourceUrl, checkedAt };
}
export function officialAgentReasoning(modelId: string) {
  const profile = officialReasoningProfile(modelId);
  return profile ? { sourceUrl: profile.sourceUrl, checkedAt: profile.checkedAt } : undefined;
}
function officialReasoningOptions(modelId: string): AgentReasoningOption[] {
  return (officialReasoningProfile(modelId)?.options ?? []).map(value => ({ value, label: LABELS[value] ?? value }));
}
function reasoningOptions(value: unknown): AgentReasoningOption[] {
  if (!Array.isArray(value)) return [];
  const options = value.flatMap(raw => {
    const record = agentRecord(raw);
    const value = typeof raw === "string" ? raw : record.value;
    return typeof value === "string" && /^[a-z][a-z0-9_-]{0,19}$/u.test(value) && value !== "auto"
      ? [{ value, label: LABELS[value] ?? (typeof record.label === "string" ? record.label.slice(0, 40) : value) }] : [];
  });
  return [...new Map(options.map(option => [option.value, option])).values()];
}

function discoveredOfficialModel(connection: ProviderConnectionRecord, model?: ModelDescriptor) {
  const discovery = agentRecord(model?.metadata?.agentDiscovery);
  return discovery.fingerprint === agentModelEvidenceFingerprint(connection) && typeof discovery.officialModelId === "string"
    && officialAgentReasoning(discovery.officialModelId) ? { officialModelId: discovery.officialModelId, sourceUrl: discovery.sourceUrl } : undefined;
}

export function resolveAgentCapabilities(connection: ProviderConnectionRecord, modelId: string, model?: ModelDescriptor) {
  const protocol = modelAgentProtocol(connection, modelId, model);
  const evidence = scopedRecord(connection, "agentModelEvidence", modelId);
  const runtime = scopedRecord(connection, "agentRuntimeProfiles", modelId);
  const channel = verifiedChannel(connection, modelId);
  const perModel = agentRecord(agentRecord(connection.config.agentModelCapabilities)[modelId]);
  const legacy = Object.keys(perModel).length ? perModel : agentRecord(connection.config.directorCapabilities);
  const declared = declaredAgentFlags(model);
  const family = familyFacts(modelId);
  const layers: Array<{ flags: Record<string, unknown>; source: AgentCapabilitySource }> = [
    { flags: agentRecord(evidence.capabilities), source: "live" },
    { flags: declared, source: "provider-catalog" },
    { flags: channel.capabilities ?? {}, source: "channel-verification" },
    { flags: OFFICIAL_AUDIO_CHAT_MODELS.has(modelId) ? { imageInput: false, audioInput: true, videoInput: false } : {}, source: "official-model" },
    { flags: family, source: "model-family" },
    { flags: legacy, source: "manual" },
  ];
  const flag = (key: string) => {
    const layer = layers.find(layer => typeof layer.flags[key] === "boolean");
    return { value: layer?.flags[key] as boolean | undefined, source: layer?.source ?? "unknown" as AgentCapabilitySource };
  };
  const image = flag("imageInput");
  const audio = flag("audioInput");
  const video = flag("videoInput");
  const assumedImage = image.value === undefined && (!model || isAgentTextModel(model));
  const audioTransport = ["openai-chat-completions", "generic-openai-compatible", "google-generate-content"].includes(protocol);
  const videoTransport = protocol === "google-generate-content";
  const explicitOptions = reasoningOptions(evidence.reasoningOptions);
  const channelOptions = reasoningOptions(channel.reasoningOptions);
  const declaredOptions = reasoningOptions(model?.metadata?.reasoningOptions ??
    model?.parameters?.find(parameter => /reasoning|thinking/iu.test(parameter.key))?.options);
  const legacyOptions = reasoningOptions(perModel.reasoningOptions);
  const discovery = agentRecord(model?.metadata?.agentDiscovery);
  const currentDiscovery = discovery.fingerprint === agentModelEvidenceFingerprint(connection);
  const mapped = discoveredOfficialModel(connection, model);
  const officialId = mapped?.officialModelId ?? (currentDiscovery && Array.isArray(discovery.mappingCandidates)
    && discovery.mappingCandidates.length ? "" : modelId);
  const officialOptions = officialReasoningOptions(officialId);
  // A successful call verifies one value; it does not revoke other supported
  // values already declared or verified for this channel.
  const declaredOrLegacy = declaredOptions.length ? declaredOptions : legacyOptions;
  const options = [...new Map((declaredOrLegacy.length ? declaredOrLegacy : [...explicitOptions, ...channelOptions, ...officialOptions])
    .map(option => [option.value, option])).values()];
  const orderedEfforts = Object.keys(LABELS);
  options.sort((a, b) => {
    const left = orderedEfforts.indexOf(a.value);
    const right = orderedEfforts.indexOf(b.value);
    return (left < 0 ? orderedEfforts.length : left) - (right < 0 ? orderedEfforts.length : right);
  });
  const nativeReasoningOptions = protocol === "anthropic-messages" ? ["low", "medium", "high", "xhigh", "max"] :
    protocol === "google-generate-content" && !/^(?:models\/)?gemini-2\.5(?:-|$)/u.test(modelId) ? ["minimal", "low", "medium", "high"] : [];
  const supportsReasoningTransport = ["openai-responses", "openai-chat-completions", "xai-responses", "generic-openai-compatible"].includes(protocol) ||
    (nativeReasoningOptions.length > 0 && options.length > 0);
  const reasoning = flag("reasoning");
  const reasoningSupported = supportsReasoningTransport && runtime.disableReasoning !== true &&
    (reasoning.value === true || (reasoning.value !== false && options.length > 0));
  // A boolean reasoning flag does not tell us which values this channel accepts.
  const unsupportedEfforts = new Set(Array.isArray(runtime.unsupportedReasoningEfforts)
    ? runtime.unsupportedReasoningEfforts.filter((value): value is string => typeof value === "string") : []);
  const effectiveOptions = reasoningSupported ? options.filter(option => !unsupportedEfforts.has(option.value) &&
    (!nativeReasoningOptions.length || nativeReasoningOptions.includes(option.value))) : [];
  const firstKnown = layers.find(layer => Object.values(layer.flags).some(value => typeof value === "boolean"));
  const inputLimits: AgentInputLimits = {};
  for (const [from, to] of [["maxInputImages", "maxImages"], ["maxInputVideos", "maxVideos"], ["maxInputAudios", "maxAudios"], ["maxInputAssets", "maxAssets"]] as const) {
    const value = model?.limits?.[from];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) inputLimits[to] = value;
  }
  const capabilities: DirectorModelCapabilities = {
    text: true,
    imageInput: image.value === true || assumedImage,
    audioInput: audio.value === true && audioTransport,
    videoInput: video.value === true && videoTransport,
    structuredOutput: runtime.disableStructuredOutput !== true && flag("structuredOutput").value === true,
    toolCalling: flag("toolCalling").value === true && protocol === "anthropic-messages",
    nativeWebSearch: false,
    reasoning: reasoningSupported,
    probeSource: firstKnown?.source === "live" ? "live" : firstKnown?.source === "manual" ? "manual" : "provider-catalog",
    ...(typeof evidence.probedAt === "string" ? { probedAt: evidence.probedAt } : {}),
  };
  return {
    protocol, capabilities,
    reasoningOptions: [AUTO, ...effectiveOptions],
    reasoningSource: (runtime.disableReasoning === true || unsupportedEfforts.size ? "live" : reasoning.value === false ? reasoning.source :
      declaredOptions.length ? "provider-catalog" : legacyOptions.length ? "manual" : explicitOptions.length ? "live" :
      channelOptions.length ? "channel-verification" : officialOptions.length ? "official-model" : reasoning.source) as AgentCapabilitySource,
    ...(!declaredOptions.length && !legacyOptions.length && officialOptions.length ? { reasoningFallback: {
      ...officialAgentReasoning(officialId)!, ...(mapped ? { officialModelId: officialId, mappingSourceUrl: mapped.sourceUrl } : {}),
    } } : {}),
    ...(currentDiscovery && typeof discovery.reason === "string" && !effectiveOptions.length ? { reasoningNotice: discovery.reason } : {}),
    inputLimits,
    imageInputStatus: (assumedImage ? "assumed" : image.value === undefined ? "unknown" : image.value ? "supported" : "unsupported") as AgentInputStatus,
    imageInputSource: assumedImage ? "default" as const : image.source,
    audioInputStatus: (audio.value === undefined ? "unknown" : audio.value && audioTransport ? "supported" : "unsupported") as AgentInputStatus,
    audioInputSource: audio.value === true && !audioTransport ? "adapter" as const : audio.source,
    videoInputStatus: (video.value === undefined ? "unknown" : video.value && videoTransport ? "supported" : "unsupported") as AgentInputStatus,
    videoInputSource: video.value === true && !videoTransport ? "adapter" as const : video.source,
    capabilitySource: firstKnown?.source ?? (assumedImage ? "default" : "unknown") as AgentCapabilitySource,
  };
}
