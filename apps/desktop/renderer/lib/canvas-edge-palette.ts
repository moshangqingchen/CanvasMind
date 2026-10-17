import type { StudioEdgeState } from "./canvas-edge-presentation";

// Focused and active result transfers share two tiny paint servers.
export const EDGE_FEATHER_ID = "canvas-edge-feather";
export const EDGE_TERMINAL_ID = "canvas-edge-terminal-halo";

export function edgeLightEnabled(selected: boolean | undefined, state: Partial<StudioEdgeState> | undefined): boolean {
  return Boolean(selected || state?.related || state?.transferring) && !state?.preview && !state?.failed;
}
