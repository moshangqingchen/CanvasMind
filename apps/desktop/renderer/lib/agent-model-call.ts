import type { DirectorAdapterInput, DirectorAdapterResult, DirectorProtocol, ResolvedDirectorConnection } from "@super-canvas/director";
import type { JsonObject, ProviderConnectionRecord } from "@super-canvas/db";
import { repository } from "./server";
import { agentModelEvidenceFingerprint, createAgentModelEvidence } from "./agent-model-capabilities";
import { directorAdapterRegistry } from "./director-adapters";
import { DirectorAdapterError, isRecord } from "./director-adapters/shared";

interface RuntimeProfile {
  fingerprint: string;
  protocol: DirectorProtocol;
  disableStructuredOutput?: boolean;
  disableReasoning?: boolean;
  unsupportedReasoningEfforts?: string[];
  verifiedAt: string;
}

function profileFor(record: ProviderConnectionRecord | null, model: string): RuntimeProfile | undefined {
  if (!record) return;
  const profiles = record.config.agentRuntimeProfiles;
  const profile = isRecord(profiles) ? profiles[model] : undefined;
  if (isRecord(profile) && profile.fingerprint === agentModelEvidenceFingerprint(record) && typeof profile.protocol === "string")
    return profile as unknown as RuntimeProfile;
}

function applyProfile(connection: ResolvedDirectorConnection, profile?: RuntimeProfile): ResolvedDirectorConnection {
  if (!profile) return connection;
  return {
    ...connection,
    protocol: profile.protocol,
    ...(profile.disableReasoning || (connection.reasoningEffort && profile.unsupportedReasoningEfforts?.includes(connection.reasoningEffort))
      ? { reasoningEffort: undefined } : {}),
    capabilities: {
      ...connection.capabilities,
      ...(profile.disableStructuredOutput ? { structuredOutput: false } : {}),
    },
  };
}

/** Only an explicit unsupported endpoint/parameter response permits one retry. */
export function agentCompatibilityFallback(connection: ResolvedDirectorConnection, error: unknown): Partial<RuntimeProfile> | undefined {
  if (!(error instanceof DirectorAdapterError) || error.code !== "upstream" || ![400, 404, 405, 415, 422].includes(error.status ?? 0)) return;
  const detail = error.message.toLowerCase();
  // Some gateways encode balance or access failures as HTTP 400. Never retry those.
  if (/余额|额度|欠费|鉴权|权限|quota|credit|balance|billing|payment|unauthori|forbidden|api.?key/u.test(detail)) return;
  const unsupported = /unsupported|not supported|not support|unknown parameter|unrecognized|not allowed|不支持|未知参数|不允许/u.test(detail);
  if (unsupported && /response_format|json_schema|structured.output|text\.format/u.test(detail) && connection.capabilities.structuredOutput)
    return { disableStructuredOutput: true };
  if (unsupported && /reasoning(?:_effort)?|output_config[.\s]+effort|thinking[_ .]?level|思考强度/u.test(detail) && connection.reasoningEffort) {
    // A rejected enum value does not prove that the whole parameter is absent.
    const value = connection.reasoningEffort.replace(/[^a-z0-9_-]/gu, "");
    if (value && new RegExp(`(?:^|[^a-z0-9_-])${value}(?:$|[^a-z0-9_-])`, "u").test(detail))
      return { unsupportedReasoningEfforts: [connection.reasoningEffort] };
    return { disableReasoning: true };
  }
  const endpoint = /endpoint|route|path|method|\/responses|chat\/completions|接口|路径/u.test(detail);
  const missing = /not found|does not exist|cannot (?:post|get)|404|405|不存在|未找到/u.test(detail);
  if (!(endpoint && (unsupported || missing || error.status === 405))) return;
  if (connection.protocol === "openai-responses") return { protocol: "openai-chat-completions" };
  if (["openai-chat-completions", "generic-openai-compatible"].includes(connection.protocol)) return { protocol: "openai-responses" };
}

export async function completeAgentModel(connection: ResolvedDirectorConnection, input: DirectorAdapterInput): Promise<DirectorAdapterResult> {
  const original = await repository.getConnection(connection.id);
  const fingerprint = original ? agentModelEvidenceFingerprint(original) : undefined;
  const cached = profileFor(original, connection.model);
  let current = applyProfile(connection, cached);
  let profile: RuntimeProfile = {
    ...cached,
    fingerprint: fingerprint ?? "",
    protocol: current.protocol,
    verifiedAt: new Date().toISOString(),
  };
  let result: DirectorAdapterResult;
  const observedInputs = Object.fromEntries((input.attachments ?? []).map(attachment => [`${attachment.kind}Input`, true]));
  const saveEvidence = async (inputCapabilities: { imageInput?: boolean; audioInput?: boolean; videoInput?: boolean }, successfulProfile?: RuntimeProfile) => {
    if (!original || !fingerprint) return;
    const latest = await repository.getConnection(connection.id);
    if (!latest || agentModelEvidenceFingerprint(latest) !== fingerprint) return;
    const previous = isRecord(latest.config.agentRuntimeProfiles) ? latest.config.agentRuntimeProfiles : {};
    const evidence = isRecord(latest.config.agentModelEvidence) ? latest.config.agentModelEvidence : {};
    const saved = evidence[connection.model];
    const old = isRecord(saved) ? saved : undefined;
    const matching = old && old.fingerprint === fingerprint ? old : undefined;
    const capabilities = matching && isRecord(matching.capabilities) ? matching.capabilities : {};
    const options = matching && Array.isArray(matching.reasoningOptions) ? matching.reasoningOptions.filter(
      (option): option is { value: string; label: string } => isRecord(option) && typeof option.value === "string" && typeof option.label === "string",
    ) : [];
    if (successfulProfile && current.reasoningEffort && !options.some(option => option.value === current.reasoningEffort))
      options.push({ value: current.reasoningEffort, label: current.reasoningEffort });
    const newEvidence = createAgentModelEvidence(latest, {
      modelId: connection.model, ...(successfulProfile ? { protocol: current.protocol } : {}),
      capabilities: { ...capabilities, ...(successfulProfile ? { text: true } : {}),
        ...inputCapabilities,
        ...(successfulProfile && current.reasoningEffort ? { reasoning: true } : {}),
      },
      ...(options.length ? { reasoningOptions: options } : {}),
    });
    try {
      await repository.saveConnection({ ...latest, config: {
        ...latest.config,
        ...(successfulProfile ? { agentRuntimeProfiles: { ...previous, [connection.model]: successfulProfile } as unknown as JsonObject } : {}),
        agentModelEvidence: { ...evidence, [connection.model]: newEvidence } as unknown as JsonObject,
      } }, { expected: latest });
    } catch {
      // A concurrent supplier edit must win; compatibility caching is optional.
    }
  };
  try {
    result = await directorAdapterRegistry.get(current.protocol).complete(current, input);
  } catch (error) {
    if (error instanceof DirectorAdapterError && error.code === "upstream" && [400, 415, 422].includes(error.status ?? 0) &&
      /unsupported|not supported|does not support|不支持/iu.test(error.message) &&
      !/format|base64|mime|尺寸|格式|数量|count|limit|maximum|too many|quota|balance|billing|余额|鉴权/iu.test(error.message)) {
      const unsupportedInputs: { imageInput?: boolean; audioInput?: boolean; videoInput?: boolean } = {};
      for (const [kind, pattern] of [["image", /image|vision|图片|图像/iu], ["audio", /audio|音频/iu], ["video", /video|视频/iu]] as const)
        if (observedInputs[`${kind}Input`] && pattern.test(error.message)) unsupportedInputs[`${kind}Input`] = false;
      if (Object.keys(unsupportedInputs).length) await saveEvidence(unsupportedInputs);
    }
    const fallback = agentCompatibilityFallback(current, error);
    if (!fallback || input.signal?.aborted || (input.attachments?.some(a => a.kind !== "image") && fallback.protocol === "openai-responses")) throw error;
    profile = { ...profile, ...fallback,
      ...(fallback.unsupportedReasoningEfforts ? { unsupportedReasoningEfforts: [...new Set([
        ...(profile.unsupportedReasoningEfforts ?? []), ...fallback.unsupportedReasoningEfforts,
      ])] } : {}),
    };
    current = applyProfile(current, profile);
    result = await directorAdapterRegistry.get(current.protocol).complete(current, input);
  }
  input.signal?.throwIfAborted();
  await saveEvidence(observedInputs, profile);
  return result;
}
