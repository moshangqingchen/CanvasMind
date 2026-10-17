import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Position, type EdgeProps } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import { StudioEdge } from "../components/studio-edge";
import { EDGE_FEATHER_ID, EDGE_TERMINAL_ID } from "./canvas-edge-palette";

vi.mock("../components/canvas-edge-label-portal", () => ({
  CanvasEdgeLabelPortal: ({ children }: { children: React.ReactNode }) => children,
}));

function markup(extra: Partial<EdgeProps> = {}) {
  const props: EdgeProps = {
    id: "a-b", source: "a", target: "b", sourceX: 100, sourceY: 200, targetX: 700, targetY: 380,
    sourcePosition: Position.Right, targetPosition: Position.Left, ...extra,
  };
  return renderToStaticMarkup(React.createElement(StudioEdge, props));
}

describe("studio connection light", () => {
  it.each(["text", "image", "video", "audio", "asset", "result"])("keeps idle %s connections neutral and free of animated children", kind => {
    const html = markup({ data: { studio: { kind, targetKind: "video", running: true } } });
    expect(html).toContain("var(--edge-idle, #62656d)");
    expect(html).not.toMatch(/studio-edge-(?:motion|light|beam|dash)|<linearGradient|<ellipse|<circle/u);
    expect(html).not.toContain("--edge-port");
  });

  it("adds the shared light only for an explicit completed-result transfer", () => {
    const html = markup({ data: { studio: { kind: "image", running: true, transferring: true } } });
    expect(html).toContain("studio-edge-motion is-flowing is-running");
    // Work feedback adds a bounded light, keeping the base edge neutral.
    expect(html).toContain("var(--edge-idle, #62656d)");
    expect(html).not.toContain("<linearGradient");
    expect(markup({ data: { studio: { transferring: true, failed: true } } })).not.toContain("studio-edge-motion");
    expect(markup({ data: { studio: { transferring: true, preview: true } } })).not.toContain("studio-edge-motion");
  });

  it.each([
    ["horizontal", 700, 200, Position.Right, Position.Left],
    ["vertical", 100, 800, Position.Bottom, Position.Top],
    ["backward", -300, -100, Position.Right, Position.Left],
  ] as const)("keeps the source-to-target gradient defined for %s connections", (_, targetX, targetY, sourcePosition, targetPosition) => {
    const html = markup({ selected: true, targetX, targetY, sourcePosition, targetPosition });
    expect(html).toContain(`gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${targetX - 100}" y2="${targetY - 200}"`);
    expect(html).toContain('stop-color="var(--edge-focus-start, #1684dd)"');
    expect(html).toContain('stop-color="var(--edge-focus-end, #55dff3)"');
    expect(html).toContain("offset-path:path(&quot;M0,0");
  });

  it("uses two feather ellipses and small endpoint glows with no filters, masks or dashed strokes", () => {
    const html = markup({ data: { studio: { related: true, kind: "image" } } });
    expect(html.match(/<ellipse\b/gu)).toHaveLength(2);
    expect(html.match(/class="studio-edge-terminal"/gu)).toHaveLength(2);
    expect(html).toContain(`fill="url(#${EDGE_FEATHER_ID})"`);
    expect(html).toContain(`fill="url(#${EDGE_TERMINAL_ID})"`);
    expect(html).not.toMatch(/<(?:filter|mask)\b|stroke-dasharray|studio-edge-dash/u);
    // The light is portaled separately from the main static SVG group.
    expect(html).toContain('</g><div class="studio-edge-motion');
  });

  it.each([{ failed: true }, { preview: true }])("keeps selected %j connections free of moving light", state => {
    expect(markup({ selected: true, data: { studio: { related: true, ...state } } })).not.toContain("studio-edge-motion");
  });
});
