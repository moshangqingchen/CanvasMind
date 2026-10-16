import type { StudioEdgeState } from "./canvas-edge-presentation";

// Focused connections share two tiny paint servers, independent of media kind.
export const EDGE_FEATHER_ID = "canvas-edge-feather";
export const EDGE_TERMINAL_ID = "canvas-edge-terminal-halo";

export function edgeLightEnabled(selected: boolean | undefined, state: Partial<StudioEdgeState> | undefined): boolean {
  return Boolean(selected || state?.related) && !state?.preview && !state?.failed;
}
