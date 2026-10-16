import React, { type EffectCallback, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Registration = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean };
class EventSurface extends EventTarget {
  readonly registrations: Registration[] = [];
  readonly dataset: Record<string, string> = {};
  readonly classList = { contains: vi.fn(() => false) };
  readonly cards: EventSurface[] = [];
  readonly labels: EventSurface[] = [];
  readonly querySelector = vi.fn(() => null);
  readonly querySelectorAll = vi.fn((selector: string): EventSurface[] => selector === ".node-card" ? this.cards
    : selector === "[data-label-obscured]" ? this.labels : []);
  constructor(readonly selector: string, readonly parentElement: EventSurface | null = null) { super(); }
  matches(selector: string) { return selector.split(",").some(part => part.trim() === this.selector); }
  contains(node: EventSurface) {
    for (let ancestor: EventSurface | null = node; ancestor; ancestor = ancestor.parentElement) if (ancestor === this) return true;
    return false;
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!listener) return;
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    if (!this.registrations.some(entry => entry.type === type && entry.listener === listener && entry.capture === capture))
      this.registrations.push({ type, listener, capture });
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    const index = this.registrations.findIndex(entry => entry.type === type && entry.listener === listener && entry.capture === capture);
    if (index >= 0) this.registrations.splice(index, 1);
    super.removeEventListener(type, listener, options);
  }
}

const observers: TestObserver[] = [];
class TestObserver {
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  constructor(readonly callback: MutationCallback) { observers.push(this); }
  notify(records: MutationRecord[]) { this.callback(records, this as unknown as MutationObserver); }
}

type LabelElement = ReactElement<{ ref: { current: HTMLSpanElement | null } }>;
let renderLabels: () => LabelElement;
let effects: EffectCallback[] = [];
let cleanup: (() => void) | undefined;
let canvas: EventSurface;
let testWindow: EventSurface;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const requestFrame = vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
const cancelFrame = vi.fn((frame: number) => { frames.delete(frame); });
const mutation = (type: "attributes" | "childList", target: EventSurface, added: EventSurface[] = [], removed: EventSurface[] = []) =>
  ({ type, target, addedNodes: added, removedNodes: removed } as unknown as MutationRecord);

function flushFrame() {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, callback] of pending) callback(0);
}
function mount() {
  const element = renderLabels();
  element.props.ref.current = { parentElement: canvas } as unknown as HTMLSpanElement;
  for (const effect of effects.splice(0)) {
    const result = effect();
    if (typeof result === "function") cleanup = result;
  }
}

beforeAll(async () => {
  vi.doMock("react", async () => ({
    ...await vi.importActual<typeof import("react")>("react"),
    useRef: (current: unknown) => ({ current }),
    useEffect: (effect: EffectCallback) => { effects.push(effect); },
  }));
  const { CanvasPortLabels } = await import("../components/canvas-port-labels");
  renderLabels = (CanvasPortLabels as unknown as { type: () => LabelElement }).type;
});
beforeEach(() => {
  observers.length = 0; effects = []; cleanup = undefined; nextFrame = 0; frames.clear();
  requestFrame.mockClear(); cancelFrame.mockClear();
  canvas = new EventSurface(".canvas-wrap"); testWindow = new EventSurface("window");
  vi.stubGlobal("React", React);
  vi.stubGlobal("Node", EventSurface);
  vi.stubGlobal("Element", EventSurface);
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("MutationObserver", TestObserver);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
});
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

describe("delegated canvas port label lifecycle", () => {
  it("observes node insertions and narrow presentation attributes without watching its own writes", () => {
    mount();
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledExactlyOnceWith(canvas, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-connection-active"],
    });
    expect(canvas.registrations.map(({ type, capture }) => ({ type, capture }))).toEqual([{ type: "pointerover", capture: true }]);
    expect(testWindow.registrations.map(({ type }) => type)).toEqual(["pointerup", "keyup"]);
    expect(frames.size).toBe(1);
  });

  it.each(["added", "removed"])("rechecks %s node wrappers and coalesces records into one layout frame", action => {
    mount(); flushFrame(); requestFrame.mockClear();
    const nodes = new EventSurface(".react-flow__nodes", canvas), node = new EventSurface(".react-flow__node", nodes);
    const record = mutation("childList", nodes, action === "added" ? [node] : [], action === "removed" ? [node] : []);
    observers[0].notify([record]); observers[0].notify([record]);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    canvas.querySelectorAll.mockClear(); flushFrame();
    expect(canvas.querySelectorAll).toHaveBeenCalledWith(".node-card");
    expect(frames.size).toBe(0);
  });

  it("ignores progress text and descendants' child mutations while preserving class changes", () => {
    mount(); flushFrame(); requestFrame.mockClear();
    const node = new EventSurface(".react-flow__node", canvas), card = new EventSurface(".node-card", node);
    const progress = new EventSurface(".node-progress", card);
    observers[0].notify([mutation("childList", progress), mutation("childList", card), mutation("childList", node)]);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    observers[0].notify([mutation("attributes", card)]);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    flushFrame();
    observers[0].notify([mutation("attributes", new EventSurface(".port-label", card))]);
    expect(frames.size).toBe(0);
  });

  it("disconnects, cancels pending work, removes delegates and clears only obscured labels on unmount", () => {
    const label = new EventSurface(".port-label", canvas);
    label.dataset.labelObscured = "true"; label.dataset.portKind = "image";
    canvas.labels.push(label);
    mount();
    const pending = [...frames.keys()][0];
    cleanup?.(); cleanup = undefined;
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledWith(pending);
    expect(frames.size).toBe(0);
    expect(canvas.registrations).toEqual([]);
    expect(testWindow.registrations).toEqual([]);
    expect(label.dataset).toEqual({ portKind: "image" });
  });
});
