/** A root owns one portal host. Weak keys let a closed canvas and its DOM go. */
export function createCanvasPortalTarget(selector: string) {
  const targets = new WeakMap<Element, Element>();
  return (root: Element | null): Element | null => {
    if (!root) return null;
    const cached = targets.get(root);
    if (cached?.isConnected) return cached;
    const target = root.querySelector(selector);
    if (target) targets.set(root, target);
    else targets.delete(root);
    return target;
  };
}
