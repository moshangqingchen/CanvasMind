import type { Locator } from "@playwright/test";

/** Check the visible placement contract, including the cases where a full panel
 * cannot remain below its node without hiding controls behind viewport tools. */
export function attachedPanelGeometry(panel: Locator) {
  return panel.evaluate(element => {
    const node = element.closest(".react-flow__node")!;
    const card = node.querySelector(".node-card")!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const canvasElement = node.closest(".canvas-wrap")!;
    const canvas = canvasElement.getBoundingClientRect();
    const rail = document.querySelector(".editor-rail")!.getBoundingClientRect();
    const left = Math.max(canvas.left + 8, rail.width > 0 && rail.height > 0 ? rail.right + 8 : 0);
    const right = Math.min(canvas.right, window.innerWidth) - 8;
    const width = Math.min(card.width, right - left);
    const anchoredLeft = Math.min(Math.max(card.left, left), right - width);
    const top = Math.max(canvas.top, 0) + 8;
    const tools = [...canvasElement.querySelectorAll(".canvas-toolbar, .react-flow__controls, .react-flow__minimap")]
      .map(tool => tool.getBoundingClientRect()).filter(tool => tool.width > 0 && tool.height > 0 &&
        tool.right > anchoredLeft && tool.left < anchoredLeft + width);
    const bottom = Math.min(Math.min(canvas.bottom, window.innerHeight) - 8, ...tools.map(tool => tool.top - 8));
    const viewport = document.querySelector(".react-flow__viewport")!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    const height = Math.min(560 * zoom, bottom - top);
    const below = card.bottom + 10 * zoom;
    const above = card.top - 10 * zoom - height;
    const direction = below >= top && below + height <= bottom ? "below"
      : above >= top && above + height <= bottom ? "above" : "clamped";
    const anchoredTop = direction === "below" ? below : direction === "above" ? above
      : Math.max(top, Math.min(below, bottom - height));
    const close = element.querySelector('[aria-label="关闭模型与参数面板"]')!;
    return {
      zoom, width: bounds.width, y: bounds.y, height: bounds.height,
      direction, cardTop: card.top, cardBottom: card.bottom,
      expectedHeight: height, availableHeight: bottom - top,
      attachmentError: Math.max(
        Math.abs(bounds.left - anchoredLeft), Math.abs(bounds.width - width),
        left - bounds.left, bounds.right - right, top - bounds.top, bounds.bottom - bottom,
        Math.abs(bounds.top - anchoredTop), Math.abs(bounds.height - height),
        Math.abs(close.getBoundingClientRect().width - Number.parseFloat(getComputedStyle(close).width) * zoom),
      ),
    };
  });
}
