import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  closestAvailableResultPosition,
  getAutoConnectionOptions,
  getAutoConnectionTargetHandle,
  isCanvasHistoryShortcutAllowed,
  isCanvasShortcutAllowed,
  modelSupportsNodeType,
  providerSupportsNodeType,
  shouldPersistNodeChanges,
} from "./graph-ui";

describe("canvas graph UI helpers", () => {
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
      closestAvailableResultPosition(
        source,
        { width: 320, height: 214 },
        [
          {
            id: "first-result",
            position: first,
            width: 320,
            height: 214,
          },
        ],
      ),
    ).toEqual({ x: 534, y: 410 });
  });

  it("stacks pasted groups downward when the adjacent slot is occupied", () => {
    const source = {
      id: "copied-group",
      position: { x: 100, y: 180 },
      width: 420,
      height: 210,
    };
    expect(
      closestAvailableResultPosition(
        source,
        { width: 420, height: 210 },
        [
          {
            id: "first-paste",
            position: { x: 544, y: 180 },
            width: 420,
            height: 210,
          },
          {
            id: "second-paste",
            position: { x: 544, y: 406 },
            width: 420,
            height: 210,
          },
        ],
        { verticalDirection: "down" },
      ),
    ).toEqual({ x: 544, y: 632 });
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

  it("persists position, resize, and removal node changes", () => {
    expect(shouldPersistNodeChanges([{ type: "select" }])).toBe(false);
    expect(shouldPersistNodeChanges([{ type: "position" }])).toBe(true);
    expect(shouldPersistNodeChanges([{ type: "dimensions" }])).toBe(true);
    expect(shouldPersistNodeChanges([{ type: "remove" }])).toBe(true);
  });
});
