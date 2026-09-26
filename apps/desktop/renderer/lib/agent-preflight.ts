import type { GenerationRequirements } from "@super-canvas/director";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { PreparedRun } from "@super-canvas/runtime";
import { CanvasGraphSchema } from "./api-validation";

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const aliases = {
  count: ["n", "count", "num_outputs", "number_of_outputs"],
  aspectRatio: ["aspect_ratio", "aspectRatio", "ratio"],
  resolution: ["size", "resolution", "image_size", "video_size"],
  quality: ["quality", "quality_tier"],
  durationSeconds: ["duration", "duration_seconds", "seconds"],
} as const;

/** Reconstruct the quote from the frozen execution inputs, never the earlier proposal. */
export function preparedNodeRequirements(
  prepared: PreparedRun,
  nodeId: string,
  model: ModelDescriptor,
): GenerationRequirements {
  const raw = { ...prepared.revisionGraph };
  delete raw.__preparedHistoricalInputs;
  const graph = CanvasGraphSchema.parse(raw);
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error("待执行节点不存在");
  const params = object(node.data?.parameters);
  const value = (key: keyof typeof aliases) => {
    for (const alias of aliases[key]) {
      const v =
        params[alias] ??
        model.parameters?.find((p) => p.key === alias)?.default;
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const counts = { image: 0, audio: 0, video: 0 };
  const seen = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    const o = object(v);
    const kind = String(o.kind ?? o.type).replace(/\[\]$/u, "");
    if (kind === "image" || kind === "audio" || kind === "video") {
      for (const id of Array.isArray(o.assetIds) ? o.assetIds : [o.assetId]) {
        if (typeof id === "string" && !seen.has(id)) {
          seen.add(id);
          counts[kind]++;
        }
      }
    }
    Object.values(o).forEach((child) => {
      if (typeof child === "object") visit(child);
    });
  };
  visit(node.data?.parts ?? node.data?.prompt);
  visit(object(prepared.revisionGraph.__preparedHistoricalInputs)[nodeId]);
  for (const edge of graph.edges.filter(
    (e) => e.target === nodeId && prepared.nodeIds.includes(e.source),
  )) {
    const source = graph.nodes.find((n) => n.id === edge.source);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    const type = source.data?.nodeType;
    if (type === "image-generation") {
      const p = object(source.data?.parameters);
      counts.image += Number(
        p.n ?? p.count ?? p.num_outputs ?? p.number_of_outputs ?? 1,
      );
    } else if (type === "video-generation") counts.video++;
  }
  const video = node.data?.nodeType === "video-generation";
  const count = Number(value("count") ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > (video ? 1 : 20))
    throw new Error("生成数量无效");
  const requirements: GenerationRequirements = {
    operation: video
      ? counts.image
        ? "video.image-to-video"
        : "video.generate"
      : counts.image
        ? "image.edit"
        : "image.generate",
    count,
    inputKinds: (["image", "audio", "video"] as const).filter(
      (k) => counts[k] > 0,
    ),
    inputCounts: counts,
    ...(value("aspectRatio") !== undefined
      ? { aspectRatio: String(value("aspectRatio")) }
      : {}),
    ...(value("resolution") !== undefined
      ? { resolution: String(value("resolution")) }
      : {}),
    ...(value("quality") !== undefined
      ? { quality: String(value("quality")) }
      : {}),
    ...(value("durationSeconds") !== undefined
      ? { durationSeconds: Number(value("durationSeconds")) }
      : {}),
  };
  if (
    requirements.durationSeconds !== undefined &&
    (!Number.isFinite(requirements.durationSeconds) ||
      requirements.durationSeconds <= 0)
  )
    throw new Error("视频时长无效");
  return requirements;
}
