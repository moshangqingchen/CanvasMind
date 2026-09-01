import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  alignedCanvasRectPositions,
  closestAvailableResultPosition,
  closestAvailableVerticalPosition,
  getAutoConnectionOptions,
  getAutoConnectionTargetHandle,
  hasSelectedBrowserText,
  isCanvasHistoryShortcutAllowed,
  isCanvasShortcutAllowed,
  modelCanvasUnavailableReason,
  modelSupportsNodeType,
  preferredCanvasLayoutDirection,
  providerSupportsNodeType,
  shouldPersistNodeChanges,
  tidyCanvasRectPositions,
} from "./graph-ui";

describe("canvas graph UI helpers", () => {
  const alignmentRects = [
    {
      id: "one",
      position: { x: 100, y: 80 },
      width: 200,
      height: 120,
    },
    {
      id: "two",
      position: { x: 420, y: 260 },
      width: 300,
      height: 180,
    },
    {
      id: "three",
      position: { x: 780, y: 500 },
      width: 160,
      height: 100,
    },
  ];

  it("aligns different-sized nodes to selection edges and centers", () => {
    expect(
      Array.from(alignedCanvasRectPositions(alignmentRects, "left").values()),
    ).toEqual([
      { x: 100, y: 80 },
      { x: 100, y: 260 },
      { x: 100, y: 500 },
    ]);
    expect(
      Array.from(
        alignedCanvasRectPositions(alignmentRects, "center-x").values(),
      ).map((position) => position.x),
    ).toEqual([420, 370, 440]);
    expect(
      Array.from(
        alignedCanvasRectPositions(alignmentRects, "bottom").values(),
      ).map((position) => position.y),
    ).toEqual([480, 420, 500]);
  });

  it("distributes nodes evenly without allowing overlap", () => {
    const overlapping = alignmentRects.map((node, index) => ({
      ...node,
      position: { x: 100 + index * 20, y: 80 + index * 20 },
    }));
    const horizontal = alignedCanvasRectPositions(overlapping, "distribute-x");
    expect(horizontal.get("two")!.x).toBe(316);
    expect(horizontal.get("three")!.x).toBe(632);
    const vertical = alignedCanvasRectPositions(overlapping, "distribute-y");
    expect(vertical.get("two")!.y).toBe(216);
    expect(vertical.get("three")!.y).toBe(412);
  });

  it("lays out generated results as a grid between connected workflow layers", () => {
    const nodes = [
      {
        id: "prompt",
        position: { x: 680, y: 520 },
        width: 300,
        height: 140,
      },
      {
        id: "source",
        position: { x: 120, y: 100 },
        width: 420,
        height: 210,
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `result-${index}`,
        position: { x: 40 + index * 17, y: 20 + index * 29 },
        width: 200,
        height: 150,
        generatedFromNodeId: "source",
      })),
      {
        id: "target",
        position: { x: 60, y: 900 },
        width: 320,
        height: 180,
      },
    ];
    const edges = [
      { source: "prompt", target: "source" },
      { source: "source", target: "result-0" },
      { source: "result-0", target: "target" },
    ];

    const horizontal = tidyCanvasRectPositions(nodes, edges, "horizontal");
    expect(horizontal.get("source")!.x).toBeLessThan(
      horizontal.get("result-0")!.x,
    );
    expect(horizontal.get("result-0")!.y).toBe(horizontal.get("result-1")!.y);
    expect(horizontal.get("result-0")!.x).toBe(horizontal.get("result-2")!.x);
    expect(
      horizontal.get("result-1")!.x - (horizontal.get("result-0")!.x + 200),
    ).toBe(24);
    expect(horizontal.get("result-2")!.y).toBeGreaterThan(
      horizontal.get("result-0")!.y,
    );
    expect(
      horizontal.get("result-2")!.y - (horizontal.get("result-0")!.y + 150),
    ).toBe(24);
    expect(horizontal.get("source")!.y + 210 / 2).toBe(
      (horizontal.get("result-0")!.y + horizontal.get("result-2")!.y + 150) / 2,
    );
    expect(horizontal.get("target")!.x).toBeGreaterThan(
      horizontal.get("result-1")!.x + 200,
    );

    const vertical = tidyCanvasRectPositions(nodes, edges, "vertical");
    expect(vertical.get("source")!.y).toBeLessThan(vertical.get("result-0")!.y);
    expect(vertical.get("result-0")!.y).toBe(vertical.get("result-1")!.y);
    expect(vertical.get("result-0")!.x).toBe(vertical.get("result-2")!.x);
    expect(vertical.get("source")!.x + 420 / 2).toBe(
      (vertical.get("result-0")!.x + vertical.get("result-1")!.x + 200) / 2,
    );
    expect(vertical.get("target")!.y).toBeGreaterThan(
      vertical.get("result-2")!.y + 150,
    );
  });

  it("keeps connected workflows together before packing unrelated groups", () => {
    const nodes = [
      { id: "a-input", position: { x: 40, y: 60 }, width: 180, height: 120 },
      {
        id: "a-generate",
        position: { x: 520, y: 80 },
        width: 260,
        height: 160,
      },
      {
        id: "a-result",
        position: { x: 900, y: 40 },
        width: 220,
        height: 180,
        generatedFromNodeId: "a-generate",
      },
      {
        id: "b-input",
        position: { x: 80, y: 780 },
        width: 200,
        height: 150,
      },
      {
        id: "b-generate",
        position: { x: 640, y: 760 },
        width: 280,
        height: 180,
      },
      {
        id: "standalone",
        position: { x: 1_400, y: 1_100 },
        width: 240,
        height: 200,
      },
    ];
    const arranged = tidyCanvasRectPositions(
      nodes,
      [
        { source: "a-input", target: "a-generate" },
        { source: "a-generate", target: "a-result" },
        { source: "b-input", target: "b-generate" },
      ],
      "horizontal",
      { componentGap: 200, maxComponentColumns: 2 },
    );
    const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
    const bounds = (ids: string[]) => {
      const items = ids.map((id) => ({
        ...arranged.get(id)!,
        width: nodeById.get(id)!.width,
        height: nodeById.get(id)!.height,
      }));
      const left = Math.min(...items.map((item) => item.x));
      const top = Math.min(...items.map((item) => item.y));
      const right = Math.max(...items.map((item) => item.x + item.width));
      const bottom = Math.max(...items.map((item) => item.y + item.height));
      return { left, top, right, bottom };
    };
    const overlaps = (
      left: ReturnType<typeof bounds>,
      right: ReturnType<typeof bounds>,
    ) =>
      !(
        left.right <= right.left ||
        right.right <= left.left ||
        left.bottom <= right.top ||
        right.bottom <= left.top
      );

    const aBounds = bounds(["a-input", "a-generate", "a-result"]);
    const bBounds = bounds(["b-input", "b-generate"]);
    const standaloneBounds = bounds(["standalone"]);
    expect(arranged.get("a-generate")!.x).toBeGreaterThan(
      arranged.get("a-input")!.x,
    );
    expect(arranged.get("a-result")!.x).toBeGreaterThan(
      arranged.get("a-generate")!.x,
    );
    expect(arranged.get("b-generate")!.x).toBeGreaterThan(
      arranged.get("b-input")!.x,
    );
    expect(overlaps(aBounds, bBounds)).toBe(false);
    expect(overlaps(aBounds, standaloneBounds)).toBe(false);
    expect(overlaps(bBounds, standaloneBounds)).toBe(false);
    expect(aBounds.top).toBe(bBounds.top);
    expect(aBounds.left).toBe(standaloneBounds.left);
  });

  it("preserves the canvas's dominant horizontal or vertical flow", () => {
    const horizontalNodes = [
      { id: "a", position: { x: 0, y: 0 }, width: 200, height: 120 },
      { id: "b", position: { x: 800, y: 40 }, width: 200, height: 120 },
    ];
    const verticalNodes = [
      { id: "a", position: { x: 0, y: 0 }, width: 200, height: 120 },
      { id: "b", position: { x: 30, y: 800 }, width: 200, height: 120 },
    ];
    const edges = [{ source: "a", target: "b" }];

    expect(preferredCanvasLayoutDirection(horizontalNodes, edges)).toBe(
      "horizontal",
    );
    expect(preferredCanvasLayoutDirection(verticalNodes, edges)).toBe(
      "vertical",
    );
  });

  it("places generated results tightly beside their source", () => {
    expect(
      closestAvailableResultPosition(
        {
          id: "source",
          position: { x: 100, y: 200 },
          width: 420,
          height: 210,
        },
        { width: 320, height: 300 },
        [],
      ),
    ).toEqual({ x: 544, y: 200 });
  });

  it("uses the nearest free vertical slot instead of jumping a full card", () => {
    expect(
      closestAvailableResultPosition(
        {
          id: "source-lower",
          position: { x: 100, y: 430 },
          width: 420,
          height: 210,
        },
        { width: 320, height: 300 },
        [
          {
            id: "previous-result",
            position: { x: 544, y: 150 },
            width: 320,
            height: 294,
          },
        ],
      ),
    ).toEqual({ x: 544, y: 460 });
  });

  it("keeps multiple generated results in a compact non-overlapping stack", () => {
    const source = {
      id: "source",
      position: { x: 90, y: 180 },
      width: 420,
      height: 210,
    };
    const first = closestAvailableResultPosition(
      source,
      { width: 320, height: 214 },
      [],
    );
    expect(
      closestAvailableResultPosition(source, { width: 320, height: 214 }, [
        {
          id: "first-result",
          position: first,
          width: 320,
          height: 214,
        },
      ]),
    ).toEqual({ x: 534, y: 410 });
  });

  it("places pasted groups below the currently selected anchor", () => {
    const anchor = {
      id: "selected-node",
      position: { x: 100, y: 180 },
      width: 420,
      height: 210,
    };
    expect(
      closestAvailableVerticalPosition(anchor, { width: 420, height: 210 }, [
        anchor,
      ]),
    ).toEqual({ x: 100, y: 406 });
  });

  it("uses the nearest free side of the selected anchor without overlap", () => {
    const anchor = {
      id: "selected-node",
      position: { x: 300, y: 300 },
      width: 300,
      height: 180,
    };
    expect(
      closestAvailableVerticalPosition(anchor, { width: 240, height: 120 }, [
        anchor,
        {
          id: "occupied-below",
          position: { x: 300, y: 496 },
          width: 300,
          height: 180,
        },
      ]),
    ).toEqual({ x: 330, y: 164 });
  });

  it("only exposes blank-canvas targets with compatible port kinds", () => {
    expect(getAutoConnectionTargetHandle("text", "image-generation")).toBe(
      "prompt",
    );
    expect(getAutoConnectionTargetHandle("image", "video-generation")).toBe(
      "firstFrame",
    );
    expect(getAutoConnectionTargetHandle("image[]", "video-generation")).toBe(
      null,
    );
    expect(getAutoConnectionTargetHandle("video[]", "preview")).toBe("video");
    expect(getAutoConnectionTargetHandle("audio", "video-generation")).toBe(
      "referenceAudios",
    );

    const imageArrayOptions = getAutoConnectionOptions("image[]");
    expect(
      imageArrayOptions.every((option) =>
        ["image-generation", "preview"].includes(option.nodeType),
      ),
    ).toBe(true);
    expect(
      imageArrayOptions.some(
        (option) =>
          option.nodeType === "video-generation" &&
          option.targetHandle === "firstFrame",
      ),
    ).toBe(false);
  });

  it("filters providers by the operations a generation node can execute", () => {
    expect(providerSupportsNodeType("openai", "image-generation")).toBe(true);
    expect(providerSupportsNodeType("openai", "video-generation")).toBe(false);
    expect(providerSupportsNodeType("weai", "image-generation")).toBe(true);
    expect(providerSupportsNodeType("weai", "video-generation")).toBe(false);
    expect(providerSupportsNodeType("runway", "video-generation")).toBe(true);
    expect(providerSupportsNodeType("runway", "image-generation")).toBe(false);
    expect(providerSupportsNodeType("rest", "image-generation")).toBe(true);
  });

  it("filters listed models while preserving unknown connector capabilities", () => {
    const imageModel: ModelDescriptor = {
      id: "image",
      name: "Image",
      operations: ["image.generate", "image.edit"],
    };
    const videoModel: ModelDescriptor = {
      id: "video",
      name: "Video",
      operations: ["video.generate"],
    };
    const unknownModel: ModelDescriptor = {
      id: "unknown",
      name: "Unknown",
      operations: [],
    };
    expect(modelSupportsNodeType(imageModel, "image-generation")).toBe(true);
    expect(modelSupportsNodeType(imageModel, "video-generation")).toBe(false);
    expect(modelSupportsNodeType(videoModel, "video-generation")).toBe(true);
    expect(modelSupportsNodeType(unknownModel, "image-generation")).toBe(true);
  });

  it("identifies scanned display-only models without hiding their reason", () => {
    expect(
      modelCanvasUnavailableReason({
        metadata: {
          canvasRunnable: false,
          canvasUnavailableReason: "协议未验证",
        },
      }),
    ).toBe("协议未验证");
    expect(
      modelCanvasUnavailableReason({ metadata: { canvasRunnable: true } }),
    ).toBe(null);
  });

  it("requires a selected node and canvas context for shortcuts", () => {
    expect(
      isCanvasShortcutAllowed({
        selectedId: null,
        editing: false,
        inPromptEditor: false,
        modalOpen: false,
        interactiveControl: false,
      }),
    ).toBe(false);
    expect(
      isCanvasShortcutAllowed({
        selectedId: "node-1",
        editing: true,
        inPromptEditor: false,
        modalOpen: false,
        interactiveControl: false,
      }),
    ).toBe(false);
    expect(
      isCanvasShortcutAllowed({
        selectedId: "node-1",
        editing: true,
        inPromptEditor: true,
        modalOpen: false,
        interactiveControl: false,
      }),
    ).toBe(true);
    expect(
      isCanvasShortcutAllowed({
        selectedId: "node-1",
        editing: false,
        inPromptEditor: false,
        modalOpen: true,
        interactiveControl: false,
      }),
    ).toBe(false);
  });

  it("allows canvas undo without a selected node", () => {
    expect(
      isCanvasHistoryShortcutAllowed({
        editing: false,
        modalOpen: false,
        interactiveControl: false,
      }),
    ).toBe(true);
    expect(
      isCanvasHistoryShortcutAllowed({
        editing: true,
        modalOpen: false,
        interactiveControl: false,
      }),
    ).toBe(false);
    expect(
      isCanvasHistoryShortcutAllowed({
        editing: false,
        modalOpen: true,
        interactiveControl: false,
      }),
    ).toBe(false);
  });

  it("leaves copy events to the browser when document text is selected", () => {
    expect(
      hasSelectedBrowserText({
        rangeCount: 1,
        isCollapsed: false,
        toString: () => "selected prompt text",
      }),
    ).toBe(true);
    expect(
      hasSelectedBrowserText({
        rangeCount: 1,
        isCollapsed: true,
        toString: () => "",
      }),
    ).toBe(false);
    expect(hasSelectedBrowserText(null)).toBe(false);
  });

  it("persists only interactive position, resize, and removal node changes", () => {
    expect(shouldPersistNodeChanges([{ type: "select" }])).toBe(false);
    expect(shouldPersistNodeChanges([{ type: "position" }])).toBe(false);
    expect(shouldPersistNodeChanges([{ type: "dimensions" }])).toBe(false);
    expect(
      shouldPersistNodeChanges([{ type: "position", dragging: true }]),
    ).toBe(true);
    expect(
      shouldPersistNodeChanges([{ type: "position", dragging: false }]),
    ).toBe(true);
    expect(
      shouldPersistNodeChanges([{ type: "dimensions", resizing: true }]),
    ).toBe(true);
    expect(
      shouldPersistNodeChanges([{ type: "dimensions", resizing: false }]),
    ).toBe(true);
    expect(shouldPersistNodeChanges([{ type: "remove" }])).toBe(true);
    expect(
      shouldPersistNodeChanges([
        { type: "position" },
        { type: "dimensions" },
        { type: "select" },
      ]),
    ).toBe(false);
  });
});
