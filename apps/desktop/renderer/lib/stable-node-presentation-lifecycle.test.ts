import type { EffectCallback } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "../components/types";
import { flushPendingEditorEdits, registerPendingEditorEdit } from "./pending-editor-edits";

// Run the real presentation hook against React's layout/passive effect phases.
// In particular, owner passive cleanup flushes editors after layout teardown.
type Slot = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void; phase?: "layout" | "passive" };
let slots: Slot[] = [];
let cursor = 0;
let effects: Array<() => void> = [];
const nextSlot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) =>
  Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
const effectHook = (phase: "layout" | "passive") => (effect: EffectCallback, dependencies?: readonly unknown[]) => {
  const slot = nextSlot();
  if (sameDependencies(slot.dependencies, dependencies)) return;
  effects.push(() => {
    slot.cleanup?.();
    slot.dependencies = dependencies ? [...dependencies] : undefined;
    slot.phase = phase;
    const cleanup = effect();
    slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
  });
};
let useStableNodePresentationData: typeof import("./stable-node-presentation").useStableNodePresentationData;
function RenderHarness(nodes: CanvasNode[]) {
  cursor = 0; effects = [];
  const result = useStableNodePresentationData(nodes);
  for (const effect of effects) effect();
  return result;
}
function cleanup(phase: Slot["phase"]) {
  for (const slot of slots) if (slot.phase === phase) {
    slot.cleanup?.(); slot.cleanup = undefined;
  }
}
function node(onPromptPartsChange: NonNullable<CanvasNode["data"]["onPromptPartsChange"]>): CanvasNode {
  return { id: "prompt", type: "workflow", position: { x: 0, y: 0 },
    data: { nodeType: "prompt", label: "Prompt", parts: [], onPromptPartsChange } };
}

beforeAll(async () => {
  vi.doMock("react", async () => ({
    ...await vi.importActual<typeof import("react")>("react"),
    useState: (initial: unknown) => {
      const slot = nextSlot();
      if (!("value" in slot)) slot.value = typeof initial === "function" ? initial() : initial;
      return [slot.value, vi.fn()];
    },
    useMemo: (create: () => unknown, dependencies: readonly unknown[]) => {
      const slot = nextSlot();
      if (!sameDependencies(slot.dependencies, dependencies)) {
        slot.value = create(); slot.dependencies = [...dependencies];
      }
      return slot.value;
    },
    useLayoutEffect: effectHook("layout"),
    useEffect: effectHook("passive"),
  }));
  ({ useStableNodePresentationData } = await import("./stable-node-presentation"));
});
beforeEach(() => { slots = []; effects = []; cursor = 0; });
afterEach(() => { cleanup("layout"); cleanup("passive"); });

describe("presentation handler cleanup and pending editors", () => {
  it("flushes the latest committed prompt handler after layout teardown, then releases it during passive cleanup", () => {
    const first = vi.fn(), latest = vi.fn();
    const action = RenderHarness([node(first)])[0]!.data.onPromptPartsChange!;
    expect(RenderHarness([node(latest)])[0]!.data.onPromptPartsChange).toBe(action);
    const parts = [{ type: "text" as const, text: "last edit before browser back" }];
    const unregister = registerPendingEditorEdit(() => action(parts));
    try {
      cleanup("layout");
      // CanvasShell's earlier passive cleanup flushes while its active/project
      // guards still belong to this canvas, before releasing its presentation.
      flushPendingEditorEdits();
      expect(first).not.toHaveBeenCalled();
      expect(latest).toHaveBeenCalledExactlyOnceWith(parts);
      cleanup("passive");
      action([{ type: "text", text: "late callback after unmount" }]);
      expect(latest).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });

  it("never redirects a released callback to another canvas that reuses the same node ID", () => {
    const previousCanvas = vi.fn(), nextCanvas = vi.fn();
    const oldAction = RenderHarness([node(previousCanvas)])[0]!.data.onPromptPartsChange!;
    cleanup("layout"); cleanup("passive");
    slots = [];
    const nextAction = RenderHarness([node(nextCanvas)])[0]!.data.onPromptPartsChange!;
    const parts = [{ type: "text" as const, text: "new canvas edit" }];
    oldAction(parts); nextAction(parts);
    expect(previousCanvas).not.toHaveBeenCalled();
    expect(nextCanvas).toHaveBeenCalledExactlyOnceWith(parts);
    expect(nextAction).not.toBe(oldAction);
  });
});
