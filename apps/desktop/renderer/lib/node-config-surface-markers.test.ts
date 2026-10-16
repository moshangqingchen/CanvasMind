import { describe, expect, it } from "vitest";
import { acquireNodeConfigSurfaceMarkers } from "./node-config-surface-markers";

function surface(viewport: Element | null = null) {
  const attributes = new Map<string, string>();
  return {
    element: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
      closest: (selector: string) => selector === ".react-flow__viewport" ? viewport : null,
    } as unknown as Element,
    isOpen: () => attributes.get("data-node-config-open") === "true",
  };
}

describe("node configuration surface markers", () => {
  it("marks the node and nearest viewport only for the lifetime of the parameter popover", () => {
    const viewport = surface();
    const node = surface(viewport.element);
    const release = acquireNodeConfigSurfaceMarkers(node.element);
    expect(node.isOpen()).toBe(true);
    expect(viewport.isOpen()).toBe(true);
    release();
    expect(node.isOpen()).toBe(false);
    expect(viewport.isOpen()).toBe(false);
  });

  it("keeps a shared viewport raised when another node's parameters remain open", () => {
    const viewport = surface();
    const a = surface(viewport.element);
    const b = surface(viewport.element);
    const releaseA = acquireNodeConfigSurfaceMarkers(a.element);
    const releaseB = acquireNodeConfigSurfaceMarkers(b.element);
    releaseA();
    releaseA();
    expect(a.isOpen()).toBe(false);
    expect(b.isOpen()).toBe(true);
    expect(viewport.isOpen()).toBe(true);
    releaseB();
    expect(b.isOpen()).toBe(false);
    expect(viewport.isOpen()).toBe(false);
  });

  it("supports overlapping mounts and reacquiring a previously closed node", () => {
    const node = surface();
    const releaseFirst = acquireNodeConfigSurfaceMarkers(node.element);
    const releaseSecond = acquireNodeConfigSurfaceMarkers(node.element);
    releaseSecond();
    expect(node.isOpen()).toBe(true);
    releaseFirst();
    expect(node.isOpen()).toBe(false);
    const releaseNext = acquireNodeConfigSurfaceMarkers(node.element);
    releaseFirst();
    expect(node.isOpen()).toBe(true);
    releaseNext();
    expect(node.isOpen()).toBe(false);
  });

  it("does not couple independent viewport lifetimes", () => {
    const viewportA = surface();
    const viewportB = surface();
    const a = surface(viewportA.element);
    const b = surface(viewportB.element);
    const releaseA = acquireNodeConfigSurfaceMarkers(a.element);
    const releaseB = acquireNodeConfigSurfaceMarkers(b.element);
    releaseB();
    expect(viewportA.isOpen()).toBe(true);
    expect(viewportB.isOpen()).toBe(false);
    releaseA();
  });
});
