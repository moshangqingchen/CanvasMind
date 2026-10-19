import type { ModelDescriptor, ModelParameterValue } from "@super-canvas/providers";
import type { GenerationNodeType } from "./graph-ui";

const QUALITY_LABELS: Readonly<Record<string, string>> = {
  auto: "自动", low: "低", standard: "标准", medium: "中", high: "高", hd: "高清",
  xhigh: "极高", ultra: "超高", max: "最高", maximum: "最高", highest: "最高",
};

/** Presentation only: retain supplier labels and never rewrite saved/API values. */
export function parameterOptionDisplayLabel(key: string, value: ModelParameterValue | undefined, label?: string): string {
  if (value === undefined) return "";
  const raw = String(value);
  if (["quality", "image_quality", "output_quality"].includes(key)) {
    const translated = QUALITY_LABELS[raw.toLowerCase()];
    if (!label || label.toLowerCase() === raw.toLowerCase()) return translated ?? label ?? raw;
    // Common descriptors repeat the protocol enum in brackets. The enum has
    // its own secondary column/tooltip in Dropdown, and is absent from summaries.
    if (translated) return label.replace(new RegExp(`\\s*[（(]${raw}[）)]$`, "iu"), "");
  }
  return label ?? raw;
}

export function nodeParameterSummary(nodeType: GenerationNodeType, model: ModelDescriptor | undefined, parameters: Record<string, unknown>): string {
  const display = (key: string): string | undefined => {
    const value = parameters[key];
    if (value === undefined || value === null || value === "") return undefined;
    const option = model?.parameters?.find(field => field.key === key)?.options?.find(option => String(option.value) === String(value));
    return parameterOptionDisplayLabel(key, value as ModelParameterValue, option?.label);
  };
  const fields = nodeType === "music-generation"
    ? [parameters.instrumental ? "纯音乐" : "歌曲", display("audio_format")?.toUpperCase() ?? "MP3", parameters.duration ? `目标 ${parameters.duration}s` : undefined]
    : nodeType === "video-generation"
      ? model?.metadata?.parameterControlsUnavailable === true ? [] : [parameters.duration ? `${parameters.duration}s` : undefined, display("aspect_ratio") ?? display("ratio"), display("resolution")]
      : [display("image_size") ?? display("size_tier"), parameters.size === "auto" && parameters.size_tier ? "自动比例" : display("aspect_ratio") ?? display("size"), display("quality") ?? display("image_quality") ?? display("output_quality")];
  const countDescriptor = model?.parameters?.find(field => field.key === "n");
  const count = parameters.n ?? countDescriptor?.default;
  if (count !== undefined) fields.push(`${countDescriptor?.label ?? "数量"} ${String(count)}`);
  return fields.filter(Boolean).join(" · ");
}
