import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import {
  getAutoConnectionOptions,
  getAutoConnectionTargetHandle,
  isCanvasHistoryShortcutAllowed,
  isCanvasShortcutAllowed,
  modelSupportsNodeType,
  providerSupportsNodeType,
  shouldPersistNodeChanges,
} from "./graph-ui";

describe("canvas graph UI helpers", () => {
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
