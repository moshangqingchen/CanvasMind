export const NODE_CONFIG_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "label",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='slider']",
].join(", ");

interface ClosestTarget {
  closest(selector: string): unknown;
}

/**
 * Blank popover space may select its owning node, but native form controls
 * must keep their pointer event. Reselecting the node while a native select
 * opens makes Windows close and recreate the popup, which looks like flicker.
 */
export function shouldReselectNodeFromConfigPointer(
  target: ClosestTarget | null,
): boolean {
  return !target?.closest(NODE_CONFIG_INTERACTIVE_SELECTOR);
}
