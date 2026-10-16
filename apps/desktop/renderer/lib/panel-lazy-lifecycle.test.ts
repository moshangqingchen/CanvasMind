import React, { type EffectCallback, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the actual boundary/defer lifecycle with a small hook host. Import
// downloads and browser focus are intentionally left to the Playwright tests.
type Slot = { initialized?: boolean; value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void };
const slots: Slot[] = [];
let cursor = 0;
let effects: Array<() => void> = [];
let changedDuringRender = false;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const transition = vi.fn((callback: () => void) => callback());
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) =>
  Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
const nextSlot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
let WarmPanelBoundary: typeof import("../components/panel-loading").WarmPanelBoundary;
let DeferredPanelContent: typeof import("../components/deferred-panel-content").DeferredPanelContent;

function render<T>(callback: () => T): T {
  let result: T;
  do {
    cursor = 0;
    effects = [];
    changedDuringRender = false;
    result = callback();
  } while (changedDuringRender);
  for (const effect of effects) effect();
  return result;
}
function paintFrame() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

beforeAll(async () => {
  vi.doMock("react", async () => ({
    ...await vi.importActual<typeof import("react")>("react"),
    startTransition: transition,
    useState: (initial: unknown) => {
      const slot = nextSlot();
      if (!slot.initialized) {
        slot.value = typeof initial === "function" ? initial() : initial;
        slot.initialized = true;
      }
      return [slot.value, (next: unknown) => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; changedDuringRender = true; }
      }];
    },
    useMemo: (callback: () => unknown, dependencies: readonly unknown[]) => {
      const slot = nextSlot();
      if (!sameDependencies(slot.dependencies, dependencies)) {
        slot.value = callback(); slot.dependencies = [...dependencies];
      }
      return slot.value;
    },
    useEffect: (effect: EffectCallback, dependencies?: readonly unknown[]) => {
      const slot = nextSlot();
      if (sameDependencies(slot.dependencies, dependencies)) return;
      effects.push(() => {
        slot.cleanup?.();
        slot.dependencies = dependencies ? [...dependencies] : undefined;
        const cleanup = effect();
        slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    },
  }));
  vi.doMock("../components/use-dialog-focus", () => ({ useDialogFocus: () => ({ current: null }) }));
  ({ WarmPanelBoundary } = await import("../components/panel-loading"));
  ({ DeferredPanelContent } = await import("../components/deferred-panel-content"));
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  slots.length = 0; frames.clear(); effects = []; frameId = 0; transition.mockClear();
});
afterEach(() => {
  for (const slot of slots) slot.cleanup?.();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("on-demand panel lifecycle", () => {
  it("does not mount a never-opened panel, then preserves its element on close and reopen", () => {
    const child = React.createElement("div", { "data-draft": "unsent" });
    const onClose = vi.fn();
    const boundary = (open: boolean) => render(() => WarmPanelBoundary({ open, title: "素材库", children: child, onClose }));
    expect(boundary(false)).toBeNull();
    const first = boundary(true)!;
    expect(first.props.children).toBe(child);
    const closed = boundary(false)!;
    expect(closed.type).toBe(first.type);
    expect(closed.props.children).toBe(child);
    expect(closed.props.value.open).toBe(false);
    const reopened = boundary(true)!;
    expect(reopened.props.children).toBe(child);
    expect(reopened.props.value.open).toBe(true);
    expect(reopened.props.value.onClose).toBe(onClose);
  });

  it("paints the supplied closable skeleton before mounting heavy content in a transition", () => {
    const content = React.createElement("div", { "data-heavy": "true" });
    const fallback = React.createElement("section", { "data-panel-loading": "true" });
    const onReady = vi.fn();
    const panel = () => render(() => DeferredPanelContent({ children: content, fallback, onReady }));
    expect(panel()).toBe(fallback);
    expect(onReady).not.toHaveBeenCalled();
    paintFrame();
    expect(transition).not.toHaveBeenCalled();
    expect(panel()).toBe(fallback);
    vi.runOnlyPendingTimers();
    expect(transition).toHaveBeenCalledTimes(1);
    expect(panel()).toBe(content);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(panel()).toBe(content);
    expect(frames.size).toBe(0);
  });

  it("cancels the pending animation frame when a never-ready boundary unmounts", () => {
    render(() => DeferredPanelContent({ children: React.createElement("div") }));
    expect(frames.size).toBe(1);
    for (const slot of slots) slot.cleanup?.();
    expect(frames.size).toBe(0);
    paintFrame(); vi.runOnlyPendingTimers();
    expect(transition).not.toHaveBeenCalled();
  });

  it("cancels the post-paint task when unmounted between the frame and the transition", () => {
    const onReady = vi.fn();
    const view = render(() => DeferredPanelContent({ children: React.createElement("div"), onReady })) as ReactElement;
    expect(view).not.toBeNull();
    paintFrame();
    expect(vi.getTimerCount()).toBe(1);
    for (const slot of slots) slot.cleanup?.();
    expect(vi.getTimerCount()).toBe(0);
    vi.runOnlyPendingTimers();
    expect(transition).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});
