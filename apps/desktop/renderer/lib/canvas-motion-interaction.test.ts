import React, { type EffectCallback, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Registration = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean; passive: boolean };

/** A small event tree, so a child's stopPropagation really excludes ancestors' bubble listeners. */
class EventSurface {
  readonly registrations: Registration[] = [];
  readonly classes = new Set<string>();
  readonly classWrites: Array<{ name: string; enabled: boolean }> = [];
  readonly classList = {
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, enabled: boolean) => {
      this.classWrites.push({ name, enabled });
      if (enabled) this.classes.add(name); else this.classes.delete(name);
      return enabled;
    },
  };
  hidden = false;
  constructor(readonly parentElement: EventSurface | null = null) {}
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!listener) return;
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    if (this.registrations.some(item => item.type === type && item.listener === listener && item.capture === capture)) return;
    this.registrations.push({ type, listener, capture, passive: typeof options === "object" && options.passive === true });
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    const index = this.registrations.findIndex(item => item.type === type && item.listener === listener && item.capture === capture);
    if (index >= 0) this.registrations.splice(index, 1);
  }
  dispatchEvent(event: Event) {
    const path: EventSurface[] = [this];
    for (let ancestor = this.parentElement; ancestor; ancestor = ancestor.parentElement) path.push(ancestor);
    const invoke = (surface: EventSurface, capture: boolean) => {
      for (const entry of [...surface.registrations]) {
        if (entry.type !== event.type || entry.capture !== capture) continue;
        if (typeof entry.listener === "function") entry.listener.call(surface as unknown as EventTarget, event);
        else entry.listener.handleEvent(event);
      }
    };
    for (const surface of [...path].reverse()) { invoke(surface, true); if (event.cancelBubble) return !event.defaultPrevented; }
    invoke(this, false);
    if (event.bubbles) for (const surface of path.slice(1)) { if (event.cancelBubble) break; invoke(surface, false); }
    return !event.defaultPrevented;
  }
}

type Slot = { ref?: { current: unknown }; value?: unknown; initialized?: boolean; dependencies?: readonly unknown[]; cleanup?: () => void };
type FeedbackElement = ReactElement<{ ref: { current: HTMLSpanElement | null } }>;
const slots: Slot[] = [];
let cursor = 0;
let effects: Array<() => void> = [];
let renderFeedback: () => FeedbackElement;
let useCanvasMotion: typeof import("../components/canvas-motion").useCanvasMotion;
let canvas: EventSurface;
let flow: EventSurface;
let testWindow: EventSurface;
let testDocument: EventSurface;
type FlowTransform = [number, number, number];
let flowState: { transform: FlowTransform } = { transform: [0, 0, 1] };
const flowSubscriptions = new Set<() => void>();
const flowStore = {
  getState: () => flowState,
  subscribe: (listener: () => void) => {
    flowSubscriptions.add(listener);
    return () => { flowSubscriptions.delete(listener); };
  },
};
function zoomTo(zoom: number) {
  flowState = { transform: [flowState.transform[0], flowState.transform[1], zoom] };
  for (const listener of [...flowSubscriptions]) listener();
}
const nextSlot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) =>
  Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));

function mount(parent: EventSurface | null = canvas) {
  cursor = 0; effects = [];
  const element = renderFeedback();
  element.props.ref.current = { parentElement: parent } as unknown as HTMLSpanElement;
  for (const effect of effects) effect();
}
function unmount() {
  for (const slot of slots) { slot.cleanup?.(); slot.cleanup = undefined; }
}
function MotionProbe() { return useCanvasMotion(); }
function renderMotion() {
  cursor = 0; effects = [];
  const result = MotionProbe();
  for (const effect of effects) effect();
  return result;
}
function wheel() { flow.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true })); }
const interacting = () => canvas.classes.has("is-interacting");

beforeAll(async () => {
  // The component reads the actual store API directly, not a React context in this hook harness.
  vi.doMock("@xyflow/react", () => ({ useStoreApi: () => flowStore }));
  vi.doMock("react", async () => ({
    ...await vi.importActual<typeof import("react")>("react"),
    useRef: (current: unknown) => { const slot = nextSlot(); return slot.ref ??= { current }; },
    useState: (initial: unknown) => {
      const slot = nextSlot();
      if (!slot.initialized) { slot.value = typeof initial === "function" ? initial() : initial; slot.initialized = true; }
      return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
    },
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
      const slot = nextSlot();
      if (!sameDependencies(slot.dependencies, dependencies)) { slot.value = callback; slot.dependencies = [...dependencies]; }
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
  const motionModule = await import("../components/canvas-motion");
  const { CanvasInteractionFeedback } = motionModule;
  useCanvasMotion = motionModule.useCanvasMotion;
  renderFeedback = (CanvasInteractionFeedback as unknown as { type: () => FeedbackElement }).type;
});

describe("canvas motion preference callback", () => {
  it("keeps toggle identity across renders while reading the current preference and preserving storage failure behavior", () => {
    let preference: string | null = null;
    const setItem = vi.fn((_key: string, value: string) => { preference = value; });
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => preference), setItem });
    Object.assign(testWindow, { matchMedia: () => Object.assign(new EventSurface(), { matches: false }) });
    const dataset: Record<string, string> = {};
    Object.assign(testDocument, { documentElement: { dataset } });
    const changed = vi.fn(); testWindow.addEventListener("canvas-motion-preference", changed);
    const initial = renderMotion();
    const enabled = renderMotion();
    expect(enabled[0]).toBe(true);
    expect(enabled[1]).toBe(initial[1]);
    initial[1]();
    expect(setItem).toHaveBeenLastCalledWith("super-canvas:gentle-motion", "off");
    const disabled = renderMotion();
    expect(disabled[0]).toBe(false);
    expect(disabled[1]).toBe(initial[1]);
    expect(dataset.motion).toBe("off");
    disabled[1]();
    expect(setItem).toHaveBeenLastCalledWith("super-canvas:gentle-motion", "on");
    expect(renderMotion()[0]).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    setItem.mockImplementationOnce(() => { throw new Error("Storage denied"); });
    expect(() => initial[1]()).not.toThrow();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(renderMotion()[1]).toBe(initial[1]);
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  slots.length = 0; cursor = 0; effects = [];
  flowState = { transform: [0, 0, 1] }; flowSubscriptions.clear();
  canvas = new EventSurface(); flow = new EventSurface(canvas);
  testWindow = new EventSurface(); testDocument = new EventSurface();
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", Object.assign(testWindow, { setTimeout, clearTimeout }));
  vi.stubGlobal("document", testDocument);
});
afterEach(() => { unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("CanvasInteractionFeedback wheel lifecycle", () => {
  it("observes wheel passively before React Flow stops propagation and restores effects after 160ms", () => {
    mount();
    const childHandler = vi.fn((event: Event) => { expect(interacting()).toBe(true); event.stopPropagation(); });
    flow.addEventListener("wheel", childHandler);
    const bubble = vi.fn(); canvas.addEventListener("wheel", bubble);
    const registration = canvas.registrations.find(item => item.type === "wheel" && item.capture);
    expect(registration?.passive).toBe(true);
    const event = new Event("wheel", { bubbles: true, cancelable: true });
    flow.dispatchEvent(event);
    expect(childHandler).toHaveBeenCalledTimes(1);
    expect(bubble).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    vi.advanceTimersByTime(159); expect(interacting()).toBe(true);
    vi.advanceTimersByTime(1); expect(interacting()).toBe(false);
  });

  it("debounces successive wheels without clearing a pointer gesture that is still pressed", () => {
    mount(); wheel();
    vi.advanceTimersByTime(159); wheel();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(159); expect(interacting()).toBe(true);
    vi.advanceTimersByTime(1); expect(interacting()).toBe(false);
    flow.dispatchEvent(new Event("pointerdown", { bubbles: true })); wheel();
    vi.advanceTimersByTime(160); expect(interacting()).toBe(true);
    testWindow.dispatchEvent(new Event("pointerup")); expect(interacting()).toBe(false);
  });

  it.each(["blur", "pointercancel", "hidden"])("clears a pending wheel and pointer on %s", reason => {
    mount();
    flow.dispatchEvent(new Event("pointerdown", { bubbles: true })); wheel();
    if (reason === "hidden") {
      testDocument.dispatchEvent(new Event("visibilitychange"));
      expect(interacting()).toBe(true);
      testDocument.hidden = true;
      testDocument.dispatchEvent(new Event("visibilitychange"));
    } else testWindow.dispatchEvent(new Event(reason));
    expect(interacting()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000); expect(interacting()).toBe(false);
  });

  it("does not observe wheel from a sibling parameter panel", () => {
    const root = new EventSurface();
    canvas = new EventSurface(root); flow = new EventSurface(canvas);
    const parameters = new EventSurface(root);
    mount();
    parameters.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(interacting()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the capture listener and pending timer on unmount, with no duplicate subscriptions on render", () => {
    mount(); mount();
    expect(flowSubscriptions.size).toBe(1);
    expect(canvas.registrations.filter(item => item.type === "wheel")).toHaveLength(1);
    wheel(); expect(interacting()).toBe(true);
    unmount();
    expect(interacting()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(canvas.registrations).toEqual([]);
    expect(testWindow.registrations).toEqual([]);
    expect(testDocument.registrations).toEqual([]);
    expect(flowSubscriptions.size).toBe(0);
    wheel(); vi.advanceTimersByTime(200); expect(interacting()).toBe(false);
  });

  it("avoids root class writes below compact zoom and restores a live gesture only at the .55 boundary", () => {
    zoomTo(.54); mount(); mount();
    expect(flowSubscriptions.size).toBe(1);
    flow.dispatchEvent(new Event("pointerdown", { bubbles: true })); wheel();
    zoomTo(.3); zoomTo(.549);
    expect(interacting()).toBe(false);
    expect(canvas.classWrites).toEqual([]);
    zoomTo(.55);
    expect(interacting()).toBe(true);
    zoomTo(.549);
    expect(interacting()).toBe(false);
    zoomTo(.4); zoomTo(.2);
    expect(canvas.classWrites).toEqual([{ name: "is-interacting", enabled: true }, { name: "is-interacting", enabled: false }]);
    zoomTo(.55);
    expect(interacting()).toBe(true);
    testWindow.dispatchEvent(new Event("pointerup"));
    expect(interacting()).toBe(true); // The real wheel debounce still owns this gesture.
    vi.advanceTimersByTime(160);
    expect(interacting()).toBe(false);
    expect(canvas.classWrites).toHaveLength(4);
    unmount();
    expect(flowSubscriptions.size).toBe(0);
    const writes = canvas.classWrites.length;
    zoomTo(.1); zoomTo(1);
    expect(canvas.classWrites).toHaveLength(writes);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unsubscribes and clears a pending compact gesture on unmount without writing a redundant class", () => {
    zoomTo(.4); mount(); wheel();
    flow.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(flowSubscriptions.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(canvas.classWrites).toEqual([]);
    expect(canvas.registrations).toEqual([]);
    expect(testWindow.registrations).toEqual([]);
    expect(testDocument.registrations).toEqual([]);
    zoomTo(1); wheel(); vi.advanceTimersByTime(200);
    expect(interacting()).toBe(false);
    expect(canvas.classWrites).toEqual([]);
  });
});
