import {
  DIRECTOR_PROTOCOLS,
  DirectorModelCapabilitiesSchema,
  type DirectorModelCapabilities,
  type DirectorProtocol,
  type ResolvedDirectorConnection,
} from "@super-canvas/director";
import type {
  DirectorProfileRecord,
  JsonObject,
  ProviderConnectionRecord,
} from "@super-canvas/db";
import { decryptSecret } from "@super-canvas/providers";
import {
  CANGYUAN_IMAGE_BASE_URL,
  CANGYUAN_IMAGE_PRESET_ID,
} from "./provider-presets";
import {
  CYBERAFEI_API_BASE_URL,
  CYBERAFEI_PRESET_ID,
} from "./cyberafei-catalog";
import { providerConnectionSupplierKey } from "./provider-connection-options";
import { requireServerMasterKey } from "./master-key";
import { repository } from "./server";
import type { DirectorPublicProfile } from "./director-contracts";

export const DEFAULT_DIRECTOR_PROFILE_ID = "default";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value as Record<string, unknown>).flatMap(
    ([key, item]) =>
      typeof item === "string" && item.trim()
        ? [[key, item.trim()] as const]
        : [],
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function explicitProtocol(config: JsonObject): DirectorProtocol {
  const configured = stringValue(config.directorProtocol);
  if (
    configured &&
    (DIRECTOR_PROTOCOLS as readonly string[]).includes(configured)
  ) {
    return configured as DirectorProtocol;
  }
  switch (stringValue(config.protocol)) {
    case "responses":
    case "openai-responses":
      return "openai-responses";
    case "chat-completions":
    case "openai-chat-completions":
      return "openai-chat-completions";
    case "anthropic-messages":
      return "anthropic-messages";
    case "google-generate-content":
      return "google-generate-content";
    case "xai-responses":
      return "xai-responses";
    default:
      return "generic-openai-compatible";
  }
}

function conservativeCapabilities(
  protocol: DirectorProtocol,
): DirectorModelCapabilities {
  return {
    text: true,
    imageInput: false,
    audioInput: false,
    videoInput: false,
    // Generic gateways are not assumed to implement JSON Schema. Native
    // protocols opt in by contract; compatible endpoints must prove support
    // through their model metadata before this flag is enabled.
    structuredOutput: protocol !== "generic-openai-compatible",
    toolCalling: protocol === "anthropic-messages",
    nativeWebSearch: false,
    reasoning: false,
    probeSource: "provider-catalog",
  };
}

function configuredCapabilities(
  config: JsonObject,
  protocol: DirectorProtocol,
): DirectorModelCapabilities {
  const parsed = DirectorModelCapabilitiesSchema.safeParse(
    config.directorCapabilities,
  );
  return parsed.success ? parsed.data : conservativeCapabilities(protocol);
}

function connectionBaseUrl(connection: ProviderConnectionRecord): string {
  if (connection.config.preset === CANGYUAN_IMAGE_PRESET_ID) {
    return `${CANGYUAN_IMAGE_BASE_URL.replace(/\/+$/u, "")}/v1`;
  }
  if (connection.config.preset === CYBERAFEI_PRESET_ID) {
    return CYBERAFEI_API_BASE_URL;
  }
  const configured = stringValue(connection.config.baseUrl);
  if (!configured) throw new Error("导演大脑连接缺少 API Base URL");
  return configured;
}

function browserConnection(connection: ProviderConnectionRecord) {
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    config: connection.config,
    apiKeySet: Boolean(connection.encryptedSecret),
    apiKeyUsable: Boolean(connection.encryptedSecret),
    apiKey: "",
  };
}

export async function resolveDirectorConnection(
  profile: DirectorProfileRecord,
): Promise<ResolvedDirectorConnection> {
  const connection = await repository.getConnection(profile.brainConnectionId);
  if (!connection) throw new Error("导演大脑连接不存在，请重新配置");
  if (connection.config.usage === "disabled")
    throw new Error("导演大脑连接已停用，请重新选择供应商分组");
  if (!connection.encryptedSecret) throw new Error("导演大脑尚未配置 API Key");
  let apiKey: string;
  try {
    apiKey = decryptSecret(
      connection.encryptedSecret,
      requireServerMasterKey(),
    );
  } catch {
    throw new Error("导演大脑密钥无法解密，请重新填写 API Key");
  }
  const protocol = explicitProtocol({
    ...connection.config,
    ...(profile.config.protocol
      ? { directorProtocol: profile.config.protocol }
      : {}),
  });
  const supplier = providerConnectionSupplierKey(browserConnection(connection));
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    supplier,
    baseUrl: connectionBaseUrl(connection),
    protocol,
    model: profile.brainModelId,
    enabled: true,
    reasoningEffort: stringValue(profile.config.reasoningEffort),
    capabilities: configuredCapabilities(profile.config, protocol),
    apiKey,
    headers: stringRecord(connection.config.directorHeaders),
    allowLocalhost:
      process.env.NODE_ENV !== "production" &&
      connection.config.allowLocalhost === true,
  };
}

export async function getDirectorProfile(): Promise<DirectorProfileRecord | null> {
  return repository.getDirectorProfile(DEFAULT_DIRECTOR_PROFILE_ID);
}

export async function saveDirectorProfileConfiguration(input: {
  brainConnectionId: string;
  brainModelId: string;
  protocol?: DirectorProtocol;
  researchConnectionId?: string | null;
  reasoningEffort?: string | null;
  capabilities?: DirectorModelCapabilities;
  manualRates?: Record<string, number>;
}): Promise<DirectorProfileRecord> {
  const connection = await repository.getConnection(input.brainConnectionId);
  if (!connection) throw new Error("导演大脑连接不存在");
  if (connection.config.usage === "disabled")
    throw new Error("请选择未停用的供应商分组");
  if (!connection.encryptedSecret)
    throw new Error("导演大脑连接尚未配置 API Key");
  if (input.researchConnectionId) {
    const research = await repository.getConnection(input.researchConnectionId);
    if (!research?.encryptedSecret)
      throw new Error("研究连接不存在或未配置 API Key");
  }
  const current = await getDirectorProfile();
  const protocol = input.protocol ?? explicitProtocol(connection.config);
  const capabilities =
    input.capabilities ?? configuredCapabilities(connection.config, protocol);
  const nextConfig: JsonObject = {
    ...(current?.config ?? {}),
    protocol,
    capabilities,
    directorCapabilities: capabilities,
    ...(input.manualRates ? { manualRates: input.manualRates } : {}),
  };
  if (input.reasoningEffort === null) {
    delete nextConfig.reasoningEffort;
  } else if (input.reasoningEffort) {
    nextConfig.reasoningEffort = input.reasoningEffort;
  }
  return repository.saveDirectorProfile({
    id: DEFAULT_DIRECTOR_PROFILE_ID,
    brainConnectionId: input.brainConnectionId,
    brainModelId: input.brainModelId.trim(),
    researchConnectionId: input.researchConnectionId ?? null,
    config: nextConfig,
  });
}

export async function publicDirectorProfile(
  input?: DirectorProfileRecord | null,
): Promise<DirectorPublicProfile> {
  const profile = input === undefined ? await getDirectorProfile() : input;
  if (!profile) {
    return {
      id: DEFAULT_DIRECTOR_PROFILE_ID,
      configured: false,
      connected: false,
    };
  }
  const connection = await repository.getConnection(profile.brainConnectionId);
  let connected = false;
  if (connection?.encryptedSecret) {
    try {
      connected = Boolean(
        decryptSecret(connection.encryptedSecret, requireServerMasterKey()),
      );
    } catch {
      connected = false;
    }
  }
  const protocol = connection
    ? explicitProtocol({
        ...connection.config,
        ...(profile.config.protocol
          ? { directorProtocol: profile.config.protocol }
          : {}),
      })
    : undefined;
  return {
    id: profile.id,
    configured: true,
    brainConnectionId: profile.brainConnectionId,
    brainConnectionName: connection?.name,
    brainModelId: profile.brainModelId,
    protocol,
    ...(stringValue(profile.config.reasoningEffort)
      ? { reasoningEffort: stringValue(profile.config.reasoningEffort) }
      : {}),
    researchConnectionId: profile.researchConnectionId ?? undefined,
    connected,
    ...(protocol
      ? { capabilities: configuredCapabilities(profile.config, protocol) }
      : {}),
    updatedAt: profile.updatedAt,
  };
}
