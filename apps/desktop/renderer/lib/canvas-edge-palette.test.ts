import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "../components/types";
import { CanvasEdgePalette } from "../components/canvas-edge-palette";
import { EDGE_FEATHER_ID, EDGE_TERMINAL_ID, edgeLightEnabled } from "./canvas-edge-palette";

function edge(state = {}, selected = false, index = 0): CanvasEdge {
  return { id: `edge-${index}`, source: "source", target: "target", selected, data: { studio: state } };
}
const markup = (edges: CanvasEdge[]) => renderToStaticMarkup(React.createElement(CanvasEdgePalette, { edges }));

describe("shared selection light paints", () => {
  it("creates no paint servers for idle or merely running connections, regardless of media", () => {
    const edges = ["text", "image", "video", "audio"].flatMap(kind => [edge({ kind }), edge({ kind, running: true })]);
    expect(markup(edges)).toBe("");
    expect(markup([])).toBe("");
  });

  it("shares exactly two radial definitions across a thousand selected or related edges", () => {
    const edges = Array.from({ length: 1000 }, (_, index) => edge({ kind: "image", related: index % 2 === 0 }, index % 2 !== 0, index));
    const html = markup(edges);
    expect(html.match(/<radialGradient\b/gu)).toHaveLength(2);
    expect(html).not.toMatch(/<(?:mask|filter|linearGradient)\b/u);
  });

  it("uses shared IDs and transparent outer stops for a soft feather rather than a dash", () => {
    const html = markup([edge({ related: true })]);
    expect(html).toContain(`id="${EDGE_FEATHER_ID}"`);
    expect(html).toContain(`id="${EDGE_TERMINAL_ID}"`);
    expect(html).toContain('stop-color="var(--edge-light, #9cf5ff)"');
    expect(html.match(/offset="1"[^>]*stop-opacity="0"/gu)).toHaveLength(2);
  });

  it("suppresses failed and preview lights even if selected, and accepts edge or endpoint selection", () => {
    expect(edgeLightEnabled(false, undefined)).toBe(false);
    expect(edgeLightEnabled(false, { running: true })).toBe(false);
    expect(edgeLightEnabled(false, { running: true, transferring: true })).toBe(true);
    expect(edgeLightEnabled(true, undefined)).toBe(true);
    expect(edgeLightEnabled(false, { related: true })).toBe(true);
    for (const state of [{ failed: true }, { preview: true }]) {
      expect(edgeLightEnabled(true, state)).toBe(false);
      expect(markup([edge({ related: true, ...state }, true)])).toBe("");
    }
  });

  it("leaves presented and saved graph objects untouched", () => {
    const edges = [edge({ kind: "video", related: true }), edge({ kind: "text" }), edge({ kind: "asset" }, true)];
    const original = structuredClone(edges);
    expect(markup([...edges].reverse())).toEqual(markup(edges));
    expect(edges).toEqual(original);
  });
});
