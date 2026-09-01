import type {
  DirectorModelCapabilities,
  DirectorProtocol,
} from "@super-canvas/director";
import type { ModelDescriptor } from "@super-canvas/providers";

export type DirectorReasoningEffort =
  | "auto"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface DirectorReasoningOption {
  readonly value: DirectorReasoningEffort;
  readonly label: string;
}

const AUTO_OPTION: DirectorReasoningOption = { value: "auto", label: "自动" };

function metadataBoolean(
  model: ModelDescriptor | undefined,
  keys: readonly string[],
): boolean | undefined {
  const metadata = model?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function reasoningParameter(model: ModelDescriptor | undefined) {
  return model?.parameters?.find((parameter) =>
    /reasoning|thinking/iu.test(parameter.key),
  );
}

function protocolSupportsReasoning(protocol: DirectorProtocol | undefined) {
  return (
    protocol === "openai-responses" ||
    protocol === "openai-chat-completions" ||
    protocol === "xai-responses" ||
    protocol === "generic-openai-compatible"
  );
}

/**
 * Returns true only when a model advertises reasoning or belongs to a model
 * family for which the current director adapters send reasoning parameters.
 */
export function directorModelSupportsReasoning(
  model: ModelDescriptor | undefined,
  protocol?: DirectorProtocol,
  capabilities?: Pick<DirectorModelCapabilities, "reasoning">,
): boolean {
  if (!model) return false;
  const explicit = metadataBoolean(model, [
    "reasoning",
    "supportsReasoning",
    "supports_reasoning",
  ]);
  if (explicit !== undefined) return explicit;
  if (reasoningParameter(model)) return true;
  if (!protocolSupportsReasoning(protocol)) return false;
  if (capabilities?.reasoning === true) return true;
  return /(?:^|[-_/])(?:gpt-5(?:[.-]|$)|o[134](?:[-_.]|$)|grok-[a-z0-9.-]*mini(?:[-_.]|$))/iu.test(
    model.id,
  );
}

function parameterOptions(
  model: ModelDescriptor | undefined,
): DirectorReasoningOption[] | undefined {
  const parameter = reasoningParameter(model);
  const options = parameter?.options?.flatMap((option) =>
    typeof option.value === "string" && option.value.trim()
      ? [
          {
            value: option.value.trim() as DirectorReasoningEffort,
            label: option.label.trim() || option.value.trim(),
          },
        ]
      : [],
  );
  return options && options.length > 0 ? [AUTO_OPTION, ...options] : undefined;
}

/** Returns the safe effort values accepted by the selected model family. */
export function directorReasoningOptions(
  model: ModelDescriptor | undefined,
  protocol?: DirectorProtocol,
  capabilities?: Pick<DirectorModelCapabilities, "reasoning">,
): DirectorReasoningOption[] {
  if (!directorModelSupportsReasoning(model, protocol, capabilities))
    return [AUTO_OPTION];

  const fromModel = parameterOptions(model);
  if (fromModel) return fromModel;

  const normalized = model?.id.toLowerCase() ?? "";
  if (/gpt-5\.6(?:-|$)/u.test(normalized)) {
    return [
      AUTO_OPTION,
      { value: "none", label: "无" },
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
      { value: "xhigh", label: "超高" },
      { value: "max", label: "极限" },
    ];
  }
  if (/gpt-5\.(?:4|5)(?:-|$)/u.test(normalized)) {
    return [
      AUTO_OPTION,
      { value: "none", label: "无" },
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
      { value: "xhigh", label: "超高" },
    ];
  }
  if (/gpt-5(?:\.|-|$)/u.test(normalized)) {
    return [
      AUTO_OPTION,
      { value: "minimal", label: "极低" },
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
    ];
  }
  return [
    AUTO_OPTION,
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
  ];
}
