import React, { type EffectCallback, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Run the actual grid component/effect against its store boundary. A Proxy
// records CSS writes without a DOM, canvas implementation, or renderer library.
type Slot = { ref?: { current: unknown }; dependencies?: readonly unknown[]; cleanup?: () => void };
type Viewport = { getTransform: () => readonly number[]; subscribe: (listener: () => void) => () => void };
type LegacyRenderer = (surface: HTMLDivElement, viewport: Viewport) => () => void;
type GridElement = ReactElement<{ ref: { current: HTMLDivElement | null } }>;
const slots: Slot[] = [];
let cursor = 0;
let effects: Array<() => void> = [];
let transform: [number, number, number] = [0, 0, 1];
const listeners = new Set<() => void>();
const unsubscribeCalls: Array<ReturnType<typeof vi.fn>> = [];
const subscribe = vi.fn((listener: () => void) => {
  listeners.add(listener);
  const unsubscribe = vi.fn(() => { listeners.delete(listener); });
  unsubscribeCalls.push(unsubscribe);
  return unsubscribe;
});
const flow = { getState: () => ({ transform }), subscribe };
const testWindow: { __canvasPerfLegacyGridRenderer?: LegacyRenderer } = {};
let renderGrid: () => GridElement;
let surface: HTMLDivElement;
let values: Record<string, unknown>;
const writes: Array<{ property: string; value: unknown }> = [];
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) =>
  Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
const nextSlot = () => slots[cursor++] ?? (slots[cursor - 1] = {});

function render() {
  cursor = 0; effects = [];
  const element = renderGrid();
  element.props.ref.current = surface;
  for (const effect of effects) effect();
  return element;
}
function unmount() {
  for (const slot of slots) { slot.cleanup?.(); slot.cleanup = undefined; }
}
function viewport(x: number, y: number, zoom = transform[2]) {
  transform = [x, y, zoom];
  for (const listener of [...listeners]) listener();
}
function translatedOrigin(): [number, number] {
  const match = String(values.transform).match(/^translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\)$/);
  expect(match).not.toBeNull();
  return [Number(match![1]), Number(match![2])];
}
function extraExtent(property: "width" | "height") {
  const match = String(values[property]).match(/^calc\(100% \+ ([\d.]+)px\)$/);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

beforeAll(async () => {
  vi.doMock("react", async () => ({
    ...await vi.importActual<typeof import("react")>("react"),
    useRef: (current: unknown) => { const slot = nextSlot(); return slot.ref ??= { current }; },
    useLayoutEffect: (effect: EffectCallback, dependencies?: readonly unknown[]) => {
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
  vi.doMock("@xyflow/react", () => ({ useStoreApi: () => flow }));
  const { CanvasDotGrid } = await import("../components/canvas-background");
  // Keep the real React.memo wrapper; invoke its actual inner component in the
  // hook host rather than replacing or reproducing the implementation.
  renderGrid = (CanvasDotGrid as unknown as { type: () => GridElement }).type;
});

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", testWindow);
  delete testWindow.__canvasPerfLegacyGridRenderer;
  slots.length = 0; listeners.clear(); unsubscribeCalls.length = 0;
  cursor = 0; effects = []; transform = [0, 0, 1]; writes.length = 0;
  subscribe.mockClear();
  values = {
    setProperty: (property: string, value: string) => {
      values[property] = value; writes.push({ property, value });
    },
  };
  const style = new Proxy(values, {
    set: (target, property, value) => {
      writes.push({ property: String(property), value });
      return Reflect.set(target, property, value);
    },
  });
  surface = { style } as unknown as HTMLDivElement;
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe("CanvasDotGrid compositor pan", () => {
  it("writes only transform for pure pan, skips identical viewports, and subscribes only once", () => {
    render();
    expect(listeners.size).toBe(1);
    const initialRaster = { backgroundSize: values.backgroundSize, radius: values["--canvas-dot-radius"], width: values.width, height: values.height, opacity: values.opacity };
    writes.length = 0;
    viewport(87, -42);
    expect(writes.map(write => write.property)).toEqual(["transform"]);
    expect({ backgroundSize: values.backgroundSize, radius: values["--canvas-dot-radius"], width: values.width, height: values.height, opacity: values.opacity }).toEqual(initialRaster);
    writes.length = 0;
    viewport(87, -42);
    expect(writes).toEqual([]);
    render();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });

  it("updates raster spacing/radius/extents only for zoom and fades dots at low zoom", () => {
    render();
    writes.length = 0;
    viewport(0, 0, 0.5);
    expect(values.backgroundSize).toBe("10px 10px");
    expect(values["--canvas-dot-radius"]).toBe("0.2px");
    expect(extraExtent("width")).toBe(20);
    expect(extraExtent("height")).toBe(20);
    expect(writes.map(write => write.property)).toEqual(expect.arrayContaining([
      "backgroundSize", "--canvas-dot-radius", "--canvas-dot-center", "width", "height", "opacity", "transform",
    ]));
    expect(Number(values.opacity)).toBeGreaterThan(0);
    expect(Number(values.opacity)).toBeLessThan(1);
    viewport(0, 0, 0.15);
    expect(Number(values.opacity)).toBe(0);
    viewport(0, 0, 0.1);
    expect(Number(values.opacity)).toBe(0);
    viewport(0, 0, 0.7);
    expect(Number(values.opacity)).toBeCloseTo(1);
    viewport(0, 0, 2);
    expect(values.backgroundSize).toBe("40px 40px");
    expect(Number(values.opacity)).toBe(1);
  });

  it.each([0.25, 1, 2.5])("keeps all viewport edges covered for positive and negative pan at zoom %s", zoom => {
    transform = [0, 0, zoom];
    render();
    const viewportWidth = 1366, viewportHeight = 768;
    for (const [x, y] of [[0, 0], [4.25, 7.5], [-4.25, -7.5], [1738, -2419], [-2811, 1643], [50000, -50000], [-50000, 50000]]) {
      writes.length = 0;
      viewport(x!, y!);
      const [left, top] = translatedOrigin();
      expect(left).toBeLessThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(0);
      expect(left + viewportWidth + extraExtent("width")).toBeGreaterThanOrEqual(viewportWidth);
      expect(top + viewportHeight + extraExtent("height")).toBeGreaterThanOrEqual(viewportHeight);
      expect(writes.every(write => write.property === "transform")).toBe(true);
    }
  });

  it("unsubscribes on unmount so later viewport changes cannot write stale surfaces", () => {
    render();
    expect(subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribeCalls[0]).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    writes.length = 0;
    viewport(200, 300, 0.5);
    expect(writes).toEqual([]);
  });

  it("delegates to the diagnostic legacy renderer without a second subscription and runs its cleanup", () => {
    const draw = vi.fn();
    const cleanup = vi.fn();
    const legacyRenderer = vi.fn((target: HTMLDivElement, store: Viewport) => {
      expect(target).toBe(surface);
      expect(store.getTransform()).toEqual([0, 0, 1]);
      const stop = store.subscribe(draw);
      return () => { cleanup(); stop(); };
    });
    testWindow.__canvasPerfLegacyGridRenderer = legacyRenderer;
    render(); render();
    expect(legacyRenderer).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    expect(writes).toEqual([]);
    viewport(30, -40);
    expect(draw).toHaveBeenCalledTimes(1);
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(unsubscribeCalls[0]).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    viewport(50, -70);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });
});
