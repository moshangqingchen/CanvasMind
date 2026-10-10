import { describe, expect, it } from "vitest";
import { placeNodeConfigPanel, type NodeConfigPlacement, type NodeConfigRect } from "./node-config-placement";

const viewport: NodeConfigRect = { left: 0, top: 0, right: 1200, bottom: 1000 };
const panelRect = ({ left, top, width, maxHeight }: NodeConfigPlacement): NodeConfigRect => ({
  left, top, right: left + width, bottom: top + maxHeight,
});
const overlaps = (a: NodeConfigRect, b: NodeConfigRect) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
function expectWithin(panel: NodeConfigPlacement, bounds: NodeConfigRect) {
  const rect = panelRect(panel);
  expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
  expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
  expect(rect.right).toBeLessThanOrEqual(bounds.right);
  expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
}

describe("node configuration panel placement", () => {
  it("keeps the familiar node-width panel below when the full height fits", () => {
    const node = { left: 300, top: 100, right: 700, bottom: 350 };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 1 });
    expect(panel).toEqual({ left: 300, top: 360, width: 400, maxHeight: 560 });
    expect(overlaps(panelRect(panel), node)).toBe(false);
  });

  it("uses the top side when the node is near the bottom of the canvas", () => {
    const node = { left: 300, top: 700, right: 700, bottom: 950 };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 1 });
    expect(panel.top + panel.maxHeight).toBe(690);
    expect(panel.maxHeight).toBe(560);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expectWithin(panel, viewport);
  });

  it("moves beside a tall node instead of clamping a full-height panel over it", () => {
    const node = { left: 280, top: 80, right: 850, bottom: 750 };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 1 });
    expect(panel.left).toBeGreaterThanOrEqual(node.right + 10);
    expect(panel.width).toBeGreaterThanOrEqual(240);
    expect(panel.maxHeight).toBe(560);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expectWithin(panel, viewport);
  });

  it("shortens the panel to scroll when neither vertical gap fits and the sides are too narrow", () => {
    const node = { left: 40, top: 210, right: 1160, bottom: 650 };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 1 });
    expect(panel.width).toBe(1120);
    expect(panel.top).toBe(660);
    expect(panel.maxHeight).toBe(340);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expectWithin(panel, viewport);
  });

  it("uses a readable compact side instead of a wide strip that clips the header and controls", () => {
    const node = { left: 0, top: 20, right: 960, bottom: 990 };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 1 });
    expect(panel).toEqual({ left: 970, top: 20, width: 230, maxHeight: 560 });
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expectWithin(panel, viewport);
  });

  it("keeps a readable shortened panel at 200 percent zoom", () => {
    const node = { left: 40, top: 20, right: 1160, bottom: 694 };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 2 });
    expect(panel).toEqual({ left: 40, top: 714, width: 1120, maxHeight: 286 });
    expect(panel.maxHeight / 2).toBe(143);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expectWithin(panel, viewport);
  });

  it("keeps the header and scrolling controls visible in a 104 CSS pixel gap at 200 percent zoom", () => {
    const node = { left: 24, top: 104, right: 864, bottom: 464 };
    const bounds = { left: 84, top: 72, right: 972, bottom: 812 };
    const toolbar = { left: 318, top: 700, right: 664, bottom: 750 };
    const controls = { left: 14, top: 762, right: 255, bottom: 800 };
    const panel = placeNodeConfigPanel({ node, viewport: bounds, obstacles: [toolbar, controls], zoom: 2 });
    expect(panel).toEqual({ left: 84, top: 484, width: 840, maxHeight: 208 });
    expectWithin(panel, bounds);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expect(overlaps(panelRect(panel), toolbar)).toBe(false);
  });

  it("keeps an eight-screen-pixel gap from toolbars without wasting the clear side", () => {
    const node = { left: 280, top: 80, right: 850, bottom: 750 };
    const toolbar = { left: 890, top: 0, right: 1200, bottom: 80 };
    const panel = placeNodeConfigPanel({ node, viewport, obstacles: [toolbar], zoom: 1 });
    expect(panel.left).toBeGreaterThanOrEqual(node.right + 10);
    expect(panel.top).toBeGreaterThanOrEqual(toolbar.bottom + 8);
    expect(panel.maxHeight).toBe(560);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expectWithin(panel, viewport);
  });

  it("accounts for a canvas offset and scaled node gaps at different zoom levels", () => {
    const bounds = { left: 220, top: 90, right: 1420, bottom: 1090 };
    const node = { left: 300, top: 120, right: 500, bottom: 250 };
    const panel = placeNodeConfigPanel({ node, viewport: bounds, zoom: 0.5 });
    expect(panel).toEqual({ left: 300, top: 255, width: 200, maxHeight: 280 });
    expectWithin(panel, bounds);
  });

  it("maintains separation throughout zoom and panning, including overlapping toolbar exclusion areas", () => {
    const bounds = { left: 20, top: 80, right: 1300, bottom: 1040 };
    const obstacles = [
      { left: 40, top: 96, right: 640, bottom: 148 },
      { left: 470, top: 960, right: 850, bottom: 1020 },
      { left: 36, top: 480, right: 80, bottom: 700 },
      { left: 48, top: 650, right: 94, bottom: 710 },
    ];
    for (const zoom of [0.5, 1, 1.5, 2]) {
      for (const left of [-120, 100, 480, 840, 1180]) {
        for (const top of [-40, 120, 400, 740, 940]) {
          const node = { left, top, right: left + 340 * zoom, bottom: top + 260 * zoom };
          const panel = placeNodeConfigPanel({ node, viewport: bounds, obstacles, zoom });
          const rect = panelRect(panel);
          expect(panel.width).toBeGreaterThan(0);
          expect(panel.maxHeight).toBeGreaterThan(0);
          expectWithin(panel, bounds);
          expect(overlaps(rect, node), JSON.stringify({ node, panel })).toBe(false);
          for (const obstacle of obstacles) {
            const padded = { left: obstacle.left - 8, top: obstacle.top - 8, right: obstacle.right + 8, bottom: obstacle.bottom + 8 };
            expect(overlaps(rect, padded), JSON.stringify({ node, panel, obstacle })).toBe(false);
          }
        }
      }
    }
  });

  it("never covers a node that fills the whole viewport, even when no visible placement is possible", () => {
    const node = { left: -30, top: -20, right: 1230, bottom: 1020 };
    const originalNode = { ...node };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 1 });
    expect(panel.top).toBeGreaterThan(node.bottom);
    expect(panel.width).toBe(1200);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    expect(node).toEqual(originalNode);
  });

  it("does not clip the header and all controls into the last ten pixels below a nearly full node", () => {
    const node = { left: 0, top: 0, right: 1200, bottom: 980 };
    const panel = placeNodeConfigPanel({ node, viewport, zoom: 1 });
    expect(panel.top).toBe(990);
    expect(panel.width).toBe(1200);
    expect(panel.maxHeight).toBe(560);
    expect(overlaps(panelRect(panel), node)).toBe(false);
    const pannedNode = { ...node, top: node.top - 180, bottom: node.bottom - 180 };
    const revealed = placeNodeConfigPanel({ node: pannedNode, viewport, zoom: 1 });
    expect(revealed.maxHeight).toBeGreaterThanOrEqual(120);
    expectWithin(revealed, viewport);
    expect(overlaps(panelRect(revealed), pannedNode)).toBe(false);
  });
});
