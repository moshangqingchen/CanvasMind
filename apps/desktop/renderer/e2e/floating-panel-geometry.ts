import type { Locator } from "@playwright/test";

/** Measure the root-owned card in screen coordinates, independently of node zoom. */
export function floatingPanelGeometry(panel: Locator) {
  return panel.evaluate(element => {
    const nodeId = (element as HTMLElement).dataset.configNodeId;
    const node = nodeId ? document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`) : null;
    const card = node?.querySelector(".node-card")?.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const canvasElement = element.closest(".canvas-wrap") ?? document.querySelector(".canvas-wrap")!;
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
    const tools = [...document.querySelectorAll(".canvas-toolbar, .react-flow__controls, .react-flow__minimap, aside.inspector, .canvas-parameter-dock .node-config-docked")]
      .filter(tool => tool !== element)
      .map(tool => tool.getBoundingClientRect()).filter(tool => tool.width > 0 && tool.height > 0);
    const viewport = document.querySelector(".react-flow__viewport")!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    const panelStyle = getComputedStyle(element);
    const close = element.querySelector('[aria-label="关闭模型与参数面板"]')!;
    const closeBounds = close.getBoundingClientRect();
    const closeStyle = getComputedStyle(close);
    const expectedHeight = Number.parseFloat(panelStyle.height);
    // Nodes are allowed behind a screen overlay; their geometry is diagnostic.
    const nodeOverlap = card ? overlapDepth(card) : 0;
    const toolOverlap = Math.max(0, ...tools.map(tool => overlapDepth(tool, 8)));
    const scaleError = Math.max(
      Math.abs(bounds.width - Number.parseFloat(panelStyle.width)),
      Math.abs(bounds.height - expectedHeight),
      Math.abs(closeBounds.width - Number.parseFloat(closeStyle.width)),
      Math.abs(closeBounds.height - Number.parseFloat(closeStyle.height)),
    );
    return {
      zoom, x: bounds.x, width: bounds.width, y: bounds.y, height: bounds.height,
      ownerPresent: Boolean(card), cardTop: card?.top ?? null, cardBottom: card?.bottom ?? null,
      expectedHeight, availableHeight: bottom - top,
      nodeOverlap, toolOverlap, scaleError,
      floatingError: Math.max(0,
        toolOverlap, scaleError,
        left - bounds.left, bounds.right - right, top - bounds.top, bounds.bottom - bottom,
      ),
    };
  });
}
