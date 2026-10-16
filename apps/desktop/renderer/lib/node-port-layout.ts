/** Shared by the rendered handles and layout's not-yet-measured fallback. */
function fixedInputPosition(nodeType: string | undefined, direction: "input" | "output", index: number, total: number) {
  return direction === "input" && ["image-generation", "video-generation", "music-generation"].includes(nodeType ?? "")
    ? { preferred: 58 + index * 42, clearance: (total - index) * 24 }
    : undefined;
}

export function nodePortTop(nodeType: string | undefined, direction: "input" | "output", index: number, total: number): string {
  const fixed = fixedInputPosition(nodeType, direction, index, total);
  return fixed ? `min(${fixed.preferred}px, calc(100% - ${fixed.clearance}px))` : `${((index + 1) / (total + 1)) * 100}%`;
}

export function fallbackNodePortY(nodeType: string | undefined, direction: "input" | "output", index: number, total: number, height: number, border = 1): number {
  const fixed = fixedInputPosition(nodeType, direction, index, total);
  // The positioned card keeps a 1px structural border. CSS top is relative
  // to its padding box; React Flow's handle coordinates include that border.
  const innerHeight = Math.max(0, height - border * 2);
  return border + (fixed ? Math.min(fixed.preferred, innerHeight - fixed.clearance) : innerHeight * (index + 1) / (total + 1));
}
