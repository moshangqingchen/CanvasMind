import { readUiPreference, writeUiPreference } from "./ui-preferences";

export type CanvasArrangementOrder = "filename" | "connection";
export const CANVAS_ARRANGEMENT_ORDER_KEY = "supercanvas:canvas-arrangement-order";

const fileNameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function readCanvasArrangementOrder(): CanvasArrangementOrder {
  return readUiPreference(CANVAS_ARRANGEMENT_ORDER_KEY) === "connection" ? "connection" : "filename";
}

export function writeCanvasArrangementOrder(order: CanvasArrangementOrder): boolean {
  return writeUiPreference(CANVAS_ARRANGEMENT_ORDER_KEY, order);
}

/** Stable input order is also the fallback when two file names compare equally. */
export function sortCanvasArrangementItems<T>(
  items: readonly T[],
  order: CanvasArrangementOrder,
  getName: (item: T) => string | undefined,
  getId: (item: T) => string = () => "",
): T[] {
  if (order === "connection") return [...items];
  return items.map((item, index) => ({ item, index, name: getName(item)?.trim() ?? "" }))
    .sort((a, b) => fileNameCollator.compare(a.name, b.name) || a.index - b.index ||
      fileNameCollator.compare(getId(a.item), getId(b.item)))
    .map(({ item }) => item);
}

/** The saved edge order determines the target's reference-material numbering. */
export function orderedIncomingCanvasEdges<T extends { target: string }>(
  targetId: string,
  edges: readonly T[],
): T[] {
  return edges.filter(edge => edge.target === targetId);
}
