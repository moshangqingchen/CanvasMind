const COVER_PALETTES = [
  { name: "mint", from: "var(--cover-1-from)", to: "var(--cover-1-to)", glow: "var(--cover-1-ink)" },
  { name: "sky", from: "var(--cover-2-from)", to: "var(--cover-2-to)", glow: "var(--cover-2-ink)" },
  { name: "peach", from: "var(--cover-3-from)", to: "var(--cover-3-to)", glow: "var(--cover-3-ink)" },
  { name: "bay", from: "var(--cover-4-from)", to: "var(--cover-4-to)", glow: "var(--cover-4-ink)" },
  { name: "sage", from: "var(--cover-5-from)", to: "var(--cover-5-to)", glow: "var(--cover-5-ink)" },
  { name: "fern", from: "var(--cover-6-from)", to: "var(--cover-6-to)", glow: "var(--cover-6-ink)" },
] as const;

/** Decorative only: stable across sorting, filtering, hydration and visits. */
export function projectCoverPalette(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  }
  return COVER_PALETTES[hash % COVER_PALETTES.length]!;
}

/** Never present an absent node count as zero or a partial total as complete. */
export function workspaceProjectStatistics(projects: readonly { nodeCount?: number }[]) {
  let nodes = 0;
  let complete = projects.length > 0;
  for (const project of projects) {
    if (typeof project.nodeCount !== "number" || !Number.isSafeInteger(project.nodeCount) || project.nodeCount < 0) {
      complete = false;
    } else {
      nodes += project.nodeCount;
    }
  }
  return { projects: projects.length, nodes: complete && Number.isSafeInteger(nodes) ? nodes : undefined };
}
