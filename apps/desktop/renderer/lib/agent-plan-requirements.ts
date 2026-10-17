import type { AgentProposal } from "./agent-contracts";

const outputKeys = ["size", "resolution", "image_size", "video_size", "size_tier", "width", "height", "image_width", "image_height"] as const;
export function currentSingleOutputResolution(message: string): string | undefined {
  const dimensions = [...new Set([...message.matchAll(/\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/giu)].map(match => `${Number(match[1])}x${Number(match[2])}`))];
  return dimensions.length === 1 ? dimensions[0] : undefined;
}
export function agentOutputParameters(parameters: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(outputKeys.flatMap(key => parameters?.[key] !== undefined ? [[key, parameters[key]]] : []));
}
export function agentOutputResolutionConflict(required: string | undefined, parameters: Readonly<Record<string, unknown>>): string | undefined {
  if (!required) return undefined;
  const normalized = (value: unknown) => String(value).toLowerCase().replace(/\s/gu, "").replace(/×/gu, "x");
  const selected = agentOutputParameters(parameters);
  const dimensions = ["size", "resolution", "image_size", "video_size"].filter(key => selected[key] !== undefined);
  // size_tier can be an application preference next to an exact size. Without
  // exact pixels it cannot establish the user's requested output dimensions.
  if (!dimensions.length && selected.size_tier !== undefined) dimensions.push("size_tier");
  for (const key of dimensions) if (normalized(selected[key]) !== normalized(required)) return `${key}=${String(selected[key])}`;
  for (const [width, height] of [["width", "height"], ["image_width", "image_height"]] as const) {
    if (selected[width] === undefined && selected[height] === undefined) continue;
    const value = `${String(selected[width] ?? "—")}x${String(selected[height] ?? "—")}`;
    if (normalized(value) !== normalized(required)) return `${width}/${height}=${value}`;
  }
  return undefined;
}

/** Preserve an unambiguous current-turn output size when a model forgets the
 * structured field. This records a user requirement, not supplier capability.
 * Multiple output sizes require explicit per-step mapping from the agent. */
export function preserveCurrentProposalRequirements(proposal: AgentProposal, currentMessage: string): AgentProposal {
  const resolution = currentSingleOutputResolution(currentMessage);
  if (proposal.calls.length !== 1 || !resolution) return proposal;
  const call = proposal.calls[0]!;
  return { ...proposal, calls: [{ ...call, requirements: { ...call.requirements, resolution } }] };
}
