export type NodeConfigRunScope = "node" | "downstream";

export interface NodeConfigKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
}

const OWNER_SELECTOR = ".node-config-popover[data-config-node-id]";
const OPEN_LAYER_SELECTOR = '[data-node-config-layer-open="true"], .node-model-select[data-open]';

/** Find the card that owns a control, including an explicitly linked portal. */
export function nodeConfigOwnerElement(target: Element | null): HTMLElement | null {
  if (!target) return null;
  const owner = target.closest<HTMLElement>(OWNER_SELECTOR);
  if (owner) return owner;
  const portal = target.closest<HTMLElement>("[data-node-config-owner-id]");
  const ownerId = portal?.getAttribute("data-node-config-owner-id");
  if (!ownerId) return null;
  // Compare attributes rather than interpolating user/node IDs into a selector.
  return [...target.ownerDocument.querySelectorAll<HTMLElement>(OWNER_SELECTOR)]
    .find(card => card.getAttribute("data-config-node-id") === ownerId) ?? null;
}

/**
 * Capture listeners yield every run chord inside a card, including repeats and
 * IME chords that its local handler must consume without submitting anything.
 */
export function isNodeConfigRunChord(event: NodeConfigKeyEvent): boolean {
  return event.key === "Enter" && Boolean(event.ctrlKey || event.metaKey);
}

/** A fresh, unclaimed physical shortcut may run this card's own node. */
export function nodeConfigRunShortcutScope(event: NodeConfigKeyEvent): NodeConfigRunScope | null {
  if (!isNodeConfigRunChord(event) || event.defaultPrevented || event.altKey ||
      event.repeat || event.isComposing || event.keyCode === 229) return null;
  return event.shiftKey ? "downstream" : "node";
}

/**
 * Child popups own the first Escape and selection keys. A generic child layer
 * marks its host while open; top-layer popovers can retain DOM ancestry, while
 * detached portals also declare data-node-config-owner-id on that host.
 */
export function nodeConfigChildLayerOpen(
  target: Element | null,
  owner = nodeConfigOwnerElement(target),
): boolean {
  if (target?.closest(OPEN_LAYER_SELECTOR)) return true;
  if (!owner) return false;
  if (owner.querySelector(OPEN_LAYER_SELECTOR) || owner.querySelector("select:open")) return true;
  const ownerId = owner.getAttribute("data-config-node-id");
  return [...owner.ownerDocument.querySelectorAll<HTMLElement>(
    '[data-node-config-owner-id][data-node-config-layer-open="true"]',
  )].some(layer => layer.getAttribute("data-node-config-owner-id") === ownerId);
}
