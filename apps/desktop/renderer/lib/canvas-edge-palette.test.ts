import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "../components/types";
import { CanvasEdgePalette } from "../components/canvas-edge-palette";
import { collectEdgePalettePairs, EDGE_COLOR_KINDS, edgePaletteId } from "./canvas-edge-palette";

function edge(kind: string, targetKind?: string, index = 0): CanvasEdge {
  return { id: `edge-${index}`, source: "source", target: "target", data: { studio: { kind, targetKind } } };
}
const markup = (edges: CanvasEdge[]) => renderToStaticMarkup(React.createElement(CanvasEdgePalette, { edges }));

describe("canvas edge palettes", () => {
  it("creates no SVG or definitions for legal same-media connections", () => {
    const edges = ["text", "image", "video", "audio"].flatMap(kind => [edge(kind, kind), edge(kind)]);
    expect(collectEdgePalettePairs(edges)).toEqual([]);
    expect(markup(edges)).toBe("");
    expect(markup([])).toBe("");
  });

  it("shares one ordered color pair across repeated historical or custom edges", () => {
    const edges = Array.from({ length: 100 }, (_, index) => edge("image", "video", index));
    expect(collectEdgePalettePairs(edges)).toEqual([{ source: "image", target: "video" }]);
    expect(markup(edges).match(/<linearGradient\b/gu)).toHaveLength(2);
  });

  it("renders normal and reverse paint servers with the exact IDs used by paths", () => {
    const html = markup([edge("text", "image")]);
    expect(html).toContain(`id="${edgePaletteId("text", "image")}" x1="0%" y1="0%" x2="100%"`);
    expect(html).toContain(`id="${edgePaletteId("text", "image", true)}" x1="100%" y1="0%" x2="0%"`);
    expect(html).toContain('stop-color="var(--edge-port-text)"');
    expect(html).toContain('stop-color="var(--edge-port-image)"');
  });

  it("caps every possible ordered combination at 60 definitions", () => {
    const edges = EDGE_COLOR_KINDS.flatMap(source => EDGE_COLOR_KINDS.map(target => edge(source, target)));
    expect(collectEdgePalettePairs([...edges, ...edges])).toHaveLength(30);
    const html = markup([...edges, ...edges]);
    expect(html.match(/<linearGradient\b/gu)).toHaveLength(60);
    expect(new Set([...html.matchAll(/<linearGradient\b[^>]*id="([^"]+)"/gu)].map(match => match[1])).size).toBe(60);
  });

  it("keeps deterministic order and leaves the presented edge objects untouched", () => {
    const edges = [edge("video", "audio"), edge("text", "image"), edge("asset", "result")];
    const original = structuredClone(edges);
    expect(collectEdgePalettePairs([...edges].reverse())).toEqual(collectEdgePalettePairs(edges));
    expect(edges).toEqual(original);
    expect(collectEdgePalettePairs([edge("unknown", "image"), edge("image", "unknown")])).toEqual([]);
    expect(collectEdgePalettePairs([{ data: { studio: { targetKind: "image" } } }]))
      .toEqual([{ source: "text", target: "image" }]);
  });
});
