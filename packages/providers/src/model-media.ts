import type { ModelDescriptor, ProviderOperation } from "./contracts.js";

export type GenerationMediaKind = "image" | "video" | "music";
type MediaModel = Pick<ModelDescriptor, "operations"> & Partial<Pick<ModelDescriptor, "id" | "outputKinds" | "metadata">>;

const nonGeneration = /(?:^|[-_\s/.])(?:understanding|understand|vision|caption(?:ing|er)?|embedding|rerank|moderation|transcription|transcribe|speech|tts|whisper|lyrics?|helper|chat|analysis|analyzer)(?:$|[-_\s/.])/iu;

/** Model IDs are only a fallback; reference-image inputs never prove image output. */
export function inferGenerationMediaKinds(id: string): GenerationMediaKind[] {
  const value = id.normalize("NFKC").trim().replace(/^(?:AZ-|leo-|doubao-|kl\d+-(?=kling)|gv\d+-(?=grok)|N (?=nano-banana))/iu, "");
  if (nonGeneration.test(value)) return [];
  if (/^(?:lyria-\d+(?:\.\d+)?(?:-pro)?|suno(?:[-_.].+)?|udio(?:[-_.].+)?|chirp-v\d+(?:[-_.].+)?|music-(?:generate|generation|generator|pro)(?:[-_.].+)?)$/iu.test(value)) return ["music"];
  if (/^grok(?:[-_.]imagine)?[-_.]image(?:$|[-_.])/iu.test(value) || /^kling(?:[-_.](?:v\d+|omni))?[-_.](?:image|text-to-image)(?:$|[-_.])/iu.test(value)) return ["image"];
  // Check output-video families first: image-to-video includes the word image.
  if (/^(?:(?:sd\d+-)?seedance|(?:mm\d+-)?minimax-h\d|happyhorse|kling|runway|sora|veo|hailuo|luma|wan\d|grok[-_.](?:imagine[-_.])?video)(?:$|[-_.\d])/iu.test(value) ||
    /^video-(?:generate|generation|generator|pro|image-to-video|text-to-video)(?:$|[-_.])/iu.test(value) || value === "omni_video_edit") return ["video"];
  if (/^(?:gpt-image|(?:gemini[-_.].*[-_.])?image|gemini[-_.].*[-_.]image|gemini[-_.]nano[-_.]banana|nano[-_ ]?banana|dall[-_ ]?e|flux|stable[-_ ]?diffusion|sdxl|imagen|seedream|midjourney)(?:$|[-_.\d])/iu.test(value)) return ["image"];
  return [];
}

function operationKinds(operations: readonly ProviderOperation[]): GenerationMediaKind[] {
  const kinds = new Set<GenerationMediaKind>();
  for (const operation of operations) {
    if (operation === "image.generate" || operation === "image.edit") kinds.add("image");
    if (operation === "video.generate" || operation === "video.image-to-video") kinds.add("video");
    if (operation === "music.generate") kinds.add("music");
  }
  return [...kinds];
}

/** Share one output classification across scans, saved catalogs, node pickers and preflight. */
export function modelGenerationMediaKinds(model: MediaModel): GenerationMediaKind[] {
  const metadata = model.metadata ?? {};
  const operations = operationKinds(model.operations ?? []);
  const inferredOperations = metadata.operationsSource === "inferred" ||
    metadata.modelFactsSource === "model-api" && metadata.outputKindsSource === "inferred";
  const capability = String(metadata.catalogCapability ?? metadata.modality ?? metadata.modelKind ?? "").toLowerCase();
  const named = inferGenerationMediaKinds(model.id ?? "");
  // Audio output may be speech or a spoken chat response. Music needs its own declaration.
  const music = operations.includes("music") && !inferredOperations || capability === "music" || named.includes("music");
  if (Array.isArray(model.outputKinds) && metadata.outputKindsSource !== "inferred") {
    const outputs = model.outputKinds.map(kind => kind.replace(/\[\]$/u, ""));
    return [...new Set(outputs.flatMap((kind): GenerationMediaKind[] => kind === "image" || kind === "video"
      ? [kind] : kind === "audio" && music ? ["music"] : []))];
  }
  if (metadata.operationsSource === "declared") return operations;
  if (capability === "image" || capability === "video" || capability === "music") return [capability];
  if (["chat", "text", "audio", "speech", "tts", "embedding", "rerank", "other"].includes(capability)) return capability === "audio" && music ? ["music"] : [];
  if (operations.length && !inferredOperations) return operations;
  return named;
}

export function modelSupportsGenerationMedia(model: MediaModel, kind: GenerationMediaKind): boolean {
  return modelGenerationMediaKinds(model).includes(kind);
}

/** Preserve declared operations; derive defaults only for declared output or precise model families. */
export function inferredMediaOperations(kinds: readonly GenerationMediaKind[]): ProviderOperation[] {
  return kinds.flatMap((kind): ProviderOperation[] => kind === "image" ? ["image.generate", "image.edit"]
    : kind === "video" ? ["video.generate", "video.image-to-video"] : ["music.generate"]);
}
