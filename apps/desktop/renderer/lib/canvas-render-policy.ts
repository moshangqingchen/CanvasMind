/** Small canvases stay mounted so panning only moves their shared viewport. */
export function shouldCullCanvasNodes(nodeCount: number, openPanelCount: number, legacy = false): boolean {
  // Node-owned parameter/download portals must survive until their owner closes.
  return openPanelCount === 0 && (legacy || nodeCount > 500);
}

/** Transient, test-injected A/B override; never persisted as a user preference. */
export function legacyCanvasCullingRequested(): boolean {
  if (typeof window === "undefined") return false;
  const config = (window as Window & { __canvasPerfSwitch?: { effect?: string; arm?: string } }).__canvasPerfSwitch;
  return config?.effect === "culling" && config.arm === "A";
}
