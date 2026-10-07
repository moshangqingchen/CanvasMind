import type { ModelDescriptor, ProviderOperation } from "@super-canvas/providers";

export function cliOperationForNode(nodeType: "image-generation" | "video-generation" | "music-generation", hasImage: boolean): ProviderOperation {
  if (nodeType === "music-generation") return "music.generate";
  return nodeType === "image-generation" ? hasImage ? "image.edit" : "image.generate" : hasImage ? "video.image-to-video" : "video.generate";
}

/** CLI input ports come from the live model contract, including explicit frame roles. */
export function cliInputPorts(model: ModelDescriptor) {
  const inputs: Array<{ id: string; kind: string; label: string; required: boolean; multiple?: boolean }> = [{ id: "prompt", kind: "text", label: "Prompt", required: false }];
  const roles = Array.isArray(model.metadata?.inputRoles) ? model.metadata.inputRoles : ["reference"];
  const supports = (kind: "image" | "video" | "audio", limit: number | undefined) => {
    const declaredKind = model.inputKinds?.some(input => input === kind || input === `${kind}[]`);
    return (model.inputKinds === undefined ? (limit ?? 0) > 0 : declaredKind) && (limit ?? 1) > 0;
  };
  if (supports("image", model.limits?.maxInputImages)) {
    if (roles.includes("firstFrame")) inputs.push({ id: "firstFrame", kind: "image", label: "首帧", required: false });
    if (roles.includes("lastFrame")) inputs.push({ id: "lastFrame", kind: "image", label: "尾帧", required: false });
    if (roles.includes("reference")) inputs.push({ id: "references", kind: "image[]", label: "参考图", required: false, multiple: true });
  }
  if (roles.includes("reference") && supports("video", model.limits?.maxInputVideos)) inputs.push({ id: "referenceVideos", kind: "video[]", label: "参考视频", required: false, multiple: true });
  if (roles.includes("reference") && supports("audio", model.limits?.maxInputAudios)) inputs.push({ id: "referenceAudios", kind: "audio[]", label: "参考音频", required: false, multiple: true });
  return inputs;
}
