import type { ModelParameterDescriptor, ValidationIssue } from "@super-canvas/providers";
import type { GenerationNodeType } from "./graph-ui";

// Unknown protocol fields stay prominent. This list only changes presentation;
// descriptor visibility, normalization and request validation remain unchanged.
const OPTIONAL_DETAIL_KEYS = new Set(["seed", "negative_prompt", "watermark"]);
const IMAGE_SIZE_QUALITY_KEYS = new Set(["size", "size_tier", "resolution", "image_size", "imageSize", "aspect_ratio", "aspectRatio", "ratio", "width", "height", "quality", "image_quality", "output_quality"]);
const MUSIC_WORK_KEYS = new Set(["title", "lyrics", "instrumental"]);

export interface ParameterPresentationGroup {
  key: "image-size" | "output" | "video" | "music-work" | "music-output" | "core" | "more";
  label: string;
  descriptors: ModelParameterDescriptor[];
  forceOpen?: boolean;
}

/** Required fields stay core; errors open the existing group without moving inputs. */
export function parameterPresentationGroups(
  nodeType: GenerationNodeType,
  descriptors: readonly ModelParameterDescriptor[],
  issues: readonly Pick<ValidationIssue, "path">[],
): ParameterPresentationGroup[] {
  const issueKeys = new Set(issues.map(issue => issue.path.replace(/^parameters\./u, "").split(/[.[]/u)[0]));
  const groups = new Map<ParameterPresentationGroup["key"], ParameterPresentationGroup>();
  const definitions: Array<[ParameterPresentationGroup["key"], string]> = nodeType === "image-generation"
    ? [["image-size", "尺寸与质量"], ["output", "输出"]]
    : nodeType === "music-generation"
      ? [["music-work", "作品与歌词"], ["music-output", "输出与节奏"]]
      : [[nodeType === "video-generation" ? "video" : "core", nodeType === "video-generation" ? "视频参数" : "生成参数"]];
  for (const [key, label] of [...definitions, ["more", "更多参数"] as const]) groups.set(key, { key, label, descriptors: [] });
  for (const descriptor of descriptors) {
    const optionalDetail = OPTIONAL_DETAIL_KEYS.has(descriptor.key) && !descriptor.required;
    const key: ParameterPresentationGroup["key"] = optionalDetail ? "more"
      : nodeType === "image-generation" ? IMAGE_SIZE_QUALITY_KEYS.has(descriptor.key) ? "image-size" : "output"
      : nodeType === "music-generation" ? MUSIC_WORK_KEYS.has(descriptor.key) ? "music-work" : "music-output"
      : nodeType === "video-generation" ? "video" : "core";
    groups.get(key)!.descriptors.push(descriptor);
    if (optionalDetail && issueKeys.has(descriptor.key)) groups.get(key)!.forceOpen = true;
  }
  return [...groups.values()];
}
