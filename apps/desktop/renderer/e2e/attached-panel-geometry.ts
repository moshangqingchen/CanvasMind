import type { Locator } from "@playwright/test";

/** Measure visible behavior, without repeating the placement implementation. */
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
    const top = Math.max(canvas.top, 0) + 8;
    const bottom = Math.min(canvas.bottom, window.innerHeight) - 8;
    const overlapDepth = (other: DOMRect, padding = 0) => Math.max(0, Math.min(
      bounds.right - other.left + padding, other.right + padding - bounds.left,
      bounds.bottom - other.top + padding, other.bottom + padding - bounds.top,
    ));
    const tools = [...canvasElement.querySelectorAll(".canvas-toolbar, .react-flow__controls, .react-flow__minimap")]
      .map(tool => tool.getBoundingClientRect()).filter(tool => tool.width > 0 && tool.height > 0);
    const viewport = document.querySelector(".react-flow__viewport")!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    const panelStyle = getComputedStyle(element);
    const close = element.querySelector('[aria-label="关闭模型与参数面板"]')!;
    const closeBounds = close.getBoundingClientRect();
    const closeStyle = getComputedStyle(close);
    const expectedHeight = Number.parseFloat(panelStyle.height) * zoom;
    const direction = bounds.top >= card.bottom - 1 ? "below"
      : bounds.bottom <= card.top + 1 ? "above"
        : bounds.left >= card.right - 1 ? "right"
          : bounds.right <= card.left + 1 ? "left" : "overlapping";
    const nodeOverlap = overlapDepth(card);
    const toolOverlap = Math.max(0, ...tools.map(tool => overlapDepth(tool, 8)));
    const scaleError = Math.max(
      Math.abs(bounds.width - Number.parseFloat(panelStyle.width) * zoom),
      Math.abs(bounds.height - expectedHeight),
      Math.abs(closeBounds.width - Number.parseFloat(closeStyle.width) * zoom),
      Math.abs(closeBounds.height - Number.parseFloat(closeStyle.height) * zoom),
    );
    return {
      zoom, width: bounds.width, y: bounds.y, height: bounds.height,
      direction, cardTop: card.top, cardBottom: card.bottom,
      expectedHeight, availableHeight: bottom - top,
      nodeOverlap, toolOverlap, scaleError,
      attachmentError: Math.max(0,
        nodeOverlap, toolOverlap, scaleError,
        left - bounds.left, bounds.right - right, top - bounds.top, bounds.bottom - bottom,
      ),
    };
  });
}
