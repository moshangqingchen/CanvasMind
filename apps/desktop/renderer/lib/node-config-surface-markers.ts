const OPEN_ATTRIBUTE = "data-node-config-open";

// Weak keys do not keep an unmounted node or viewport alive. Separate leases
// prevent closing one parameter popover from lowering another open popover.
const leases = new WeakMap<Element, Set<symbol>>();

/** Mark actual parameter surfaces, independently of download-dialog pinning. */
export function acquireNodeConfigSurfaceMarkers(
  node: Element,
  viewport: Element | null = node.closest(".react-flow__viewport"),
): () => void {
  const lease = Symbol("node-config-surface");
  const surfaces = [...new Set(viewport ? [node, viewport] : [node])];
  for (const surface of surfaces) {
    let owners = leases.get(surface);
    if (!owners) {
      owners = new Set();
      leases.set(surface, owners);
      surface.setAttribute(OPEN_ATTRIBUTE, "true");
    }
    owners.add(lease);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const surface of surfaces) {
      const owners = leases.get(surface);
      owners?.delete(lease);
      if (owners?.size === 0) {
        leases.delete(surface);
        surface.removeAttribute(OPEN_ATTRIBUTE);
      }
    }
  };
}
