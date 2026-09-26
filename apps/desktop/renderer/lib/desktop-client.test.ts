import { describe, expect, it } from "vitest";
import { registerDesktopSave, saveBeforeDesktopExit } from "./desktop-client";

describe("desktop exit save handlers", () => {
  it("does not visit handlers registered by a save-triggered render until the next exit", async () => {
    const calls: string[] = [];
    let removeReplacement = () => {};
    const removeFirst = registerDesktopSave(async () => {
      calls.push("original");
      removeFirst();
      removeReplacement = registerDesktopSave(async () => { calls.push("replacement"); });
      await Promise.resolve();
    });
    const removeSecond = registerDesktopSave(async () => { calls.push("second"); });
    try {
      await saveBeforeDesktopExit();
      expect(calls).toEqual(["original", "second"]);
      calls.length = 0;
      await saveBeforeDesktopExit();
      expect(calls).toEqual(["second", "replacement"]);
    } finally {
      removeFirst();
      removeSecond();
      removeReplacement();
    }
  });

  it("keeps the app open if any panel fails to save", async () => {
    const calls: string[] = [];
    const removeFailure = registerDesktopSave(async () => { throw new Error("unsaved review"); });
    const removeNext = registerDesktopSave(async () => { calls.push("next"); });
    try {
      await expect(saveBeforeDesktopExit()).rejects.toThrow("unsaved review");
      expect(calls).toEqual([]);
    } finally {
      removeFailure();
      removeNext();
    }
  });
});
