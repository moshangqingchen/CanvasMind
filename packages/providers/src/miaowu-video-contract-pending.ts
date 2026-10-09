import type { ModelDescriptor, ProviderOperation } from "./contracts.js";
import type { RestConnectorConfig } from "./rest.js";
import { modelGenerationMediaKinds } from "./model-media.js";

export const MIAOWU_VIDEO_CONTRACT_PENDING_REASON = "该型号的视频参数与调用协议待供应商文档确认";

const pendingIds = new Set(["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal", "video-editing"]);
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function matches(value: unknown, expected: unknown, depth = 0): boolean {
  if (value === expected) return true;
  if (depth > 16) return false;
  if (Array.isArray(expected)) return Array.isArray(value) && value.length === expected.length && expected.every((item, index) => matches(value[index], item, depth + 1));
  const actual = object(value), template = object(expected);
  if (!actual || !template || Object.keys(actual).length !== Object.keys(template).length) return false;
  return Object.keys(template).every(key => Object.hasOwn(actual, key) && matches(actual[key], template[key], depth + 1));
}

/** A free Key directory proves inventory, not a model-specific video protocol. */
export function isMiaowuUnverifiedKeyScanVideoModel(model: ModelDescriptor | undefined): boolean {
  const metadata = model?.metadata;
  return Boolean(model && pendingIds.has(model.id) && metadata?.parameterSource === "key-model-scan" &&
    metadata.parameterControlsUnavailable === true && !model.parameters?.length &&
    model.operations.some(operation => operation.startsWith("video.")) && model.operations.every(operation => operation.startsWith("video.")) &&
    modelGenerationMediaKinds(model).join("+") === "video" &&
    metadata.source !== "manual" && metadata.protocolEvidence !== "paid-test");
}

const legacyChatOverride = {
  submit: { path: "/v1/chat/completions", method: "POST", bodyMode: "json",
    template: { messages: [{ role: "user", content: "" }], stream: false }, mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/messages/0/content", source: { kind: "request", path: "$.prompt" } },
    ] },
  output: { path: "$.choices[0].message.content", fallbackPaths: ["$.video_url", "$.url", "$.data[0].url"], kind: "video", defaultMimeType: "video/mp4" },
};
const response = { taskIdPath: "$.id", statusPath: "$.status", progressPath: "$.progress", errorPath: "$.error.message" };
const legacyVideoSubmit = { path: "/v1/videos", method: "POST", bodyMode: "json", mappings: [
  { target: "/model", source: { kind: "request", path: "$.model" } },
  { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
  { target: "/seconds", source: { kind: "request", path: "$.parameters.duration" } },
  { target: "/ratio", source: { kind: "request", path: "$.parameters.aspect_ratio" }, omitIfUndefined: true },
  { target: "/resolution", source: { kind: "request", path: "$.parameters.resolution" }, omitIfUndefined: true },
  { target: "/image_urls", source: { kind: "assets", assetKind: "image" }, omitIfEmpty: true },
  { target: "/video_urls", source: { kind: "assets", assetKind: "video" }, omitIfEmpty: true },
  { target: "/audio_urls", source: { kind: "assets", assetKind: "audio" }, omitIfEmpty: true },
], response };
const legacyVideoPoll = { path: "/v1/videos/{taskId}", method: "GET", bodyMode: "none", response };
const legacyVideoOutput = { path: "$.url", fallbackPaths: ["$.data.url", "$.video_url", "$.result_url"], kind: "video", defaultMimeType: "video/mp4",
  contentFallback: { path: "/v1/dream/tasks/{taskId}/content" } };

/** Recognize the built-in base template without exempting custom routes. */
export function isMiaowuLegacyVideoBaseConnector(connector: RestConnectorConfig): boolean {
  return matches(connector.submit, legacyVideoSubmit) && matches(connector.poll, legacyVideoPoll) && matches(connector.output, legacyVideoOutput);
}

function exactBinding(config: Readonly<Record<string, unknown>>, selected: ModelDescriptor, operation?: ProviderOperation): boolean {
  if (selected.metadata?.autoInterfaceStatus === "incomplete") return false;
  const bindings = object(config.autoModelInterfaces), binding = object(bindings?.[selected.id]);
  const model = object(binding?.model), connector = object(binding?.connector), submit = object(connector?.submit), output = object(connector?.output);
  const operations = model?.operations;
  const requiredOperations = operation ? [operation] : selected.operations.filter(item => item.startsWith("video."));
  return Boolean(model?.id === selected.id && Array.isArray(operations) && requiredOperations.length && requiredOperations.every(item => operations.includes(item)) &&
    typeof submit?.path === "string" && submit.path.trim() && output?.kind === "video");
}

/** Reject only the old automatic mapping (or its explicit pending replacement), preserving custom contracts. */
export function isMiaowuUnverifiedAutoVideoContract(config: Readonly<Record<string, unknown>> | undefined, model: ModelDescriptor | undefined,
  selectedConnector?: RestConnectorConfig, operation?: ProviderOperation): boolean {
  if (!config || !isMiaowuUnverifiedKeyScanVideoModel(model) || config.preset !== "miaowu-openai-videos" ||
      (config.accountKeyGroup ?? config.modelGroup) !== "default" || exactBinding(config, model!, operation)) return false;
  try {
    const url = new URL(String(config.baseUrl ?? ""));
    if (url.origin !== "https://api.miaowuai.store" || url.username || url.password || url.search || url.hash || !/^(?:\/v1)?\/?$/u.test(url.pathname)) return false;
  } catch { return false; }
  const connector = selectedConnector ?? object(config.connector) as RestConnectorConfig | undefined;
  if (!connector) return false;
  // Only an override for this video operation changes its transport. Empty or
  // image-only maps must not exempt the unchanged automatic video route.
  const operations = operation ? [operation] : model!.operations;
  if (operations.some(item => item.startsWith("video.") && Object.keys(connector.operationOverrides?.[item] ?? {}).length > 0)) return false;
  const override = connector.modelOverrides?.[model!.id];
  if (override) return matches(override, legacyChatOverride);
  return model!.metadata?.miaowuVideoContractPending === true && matches(connector.submit, legacyVideoSubmit) &&
    matches(connector.poll, legacyVideoPoll) && matches(connector.output, legacyVideoOutput);
}
