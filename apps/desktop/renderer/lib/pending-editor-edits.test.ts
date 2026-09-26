import { describe, expect, it, vi } from "vitest";
import { flushPendingEditorEdits, registerPendingEditorEdit } from "./pending-editor-edits";

describe("pending editor edits", () => {
  it("synchronously flushes each mounted editor before save reads its state", () => {
    const state: string[] = [];
    const unregisterFirst = registerPendingEditorEdit(() => { state.push("first"); });
    const unregisterSecond = registerPendingEditorEdit(() => { state.push("second"); });
    try {
      flushPendingEditorEdits();
      expect(state).toEqual(["first", "second"]);
    } finally {
      unregisterFirst();
      unregisterSecond();
    }
  });

  it("stops calling an unmounted editor without unregistering another matching callback", () => {
    const flush = vi.fn();
    const unregisterFirst = registerPendingEditorEdit(flush);
    const unregisterSecond = registerPendingEditorEdit(flush);
    try {
      unregisterFirst();
      unregisterFirst();
      flushPendingEditorEdits();
      expect(flush).toHaveBeenCalledTimes(1);
      unregisterSecond();
      flushPendingEditorEdits();
      expect(flush).toHaveBeenCalledTimes(1);
    } finally {
      unregisterFirst();
      unregisterSecond();
    }
  });
});
