import { describe, expect, it } from "vitest";
import {
  isNodeConfigRunChord,
  nodeConfigChildLayerOpen,
  nodeConfigOwnerElement,
  nodeConfigRunShortcutScope,
  promptEditorRunShortcutScope,
  type NodeConfigKeyEvent,
} from "./node-config-interaction";

const chord: NodeConfigKeyEvent = { key: "Enter", ctrlKey: true };

describe("parameter card run shortcut ownership", () => {
  it("routes a fresh Ctrl/Cmd shortcut to the owner's node or downstream scope", () => {
    expect(nodeConfigRunShortcutScope(chord)).toBe("node");
    expect(nodeConfigRunShortcutScope({ key: "Enter", metaKey: true })).toBe("node");
    expect(nodeConfigRunShortcutScope({ ...chord, shiftKey: true })).toBe("downstream");
    expect(nodeConfigRunShortcutScope({ key: "Enter", metaKey: true, shiftKey: true })).toBe("downstream");
    expect(nodeConfigRunShortcutScope({ key: "Enter" })).toBeNull();
    expect(nodeConfigRunShortcutScope({ key: "Escape", ctrlKey: true })).toBeNull();
  });

  it.each([
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { defaultPrevented: true },
    { altKey: true },
  ])("retains capture ownership but refuses to submit an excluded chord: %j", excluded => {
    const event = { ...chord, ...excluded };
    expect(isNodeConfigRunChord(event)).toBe(true);
    expect(nodeConfigRunShortcutScope(event)).toBeNull();
  });
});

describe("inline prompt editor reserved run shortcuts", () => {
  it.each([
    { ctrlKey: true, shiftKey: false, scope: "node" },
    { ctrlKey: true, shiftKey: true, scope: "downstream" },
    { metaKey: true, shiftKey: false, scope: "node" },
    { metaKey: true, shiftKey: true, scope: "downstream" },
  ] as const)("routes the editor-reserved chord without relaxing parameter controls: %j", ({ scope, ...modifiers }) => {
    // KeyboardEvent properties are inherited/non-enumerable. Passing the real
    // event must retain modifiers rather than losing them in an object spread.
    const event = Object.create(Object.defineProperties({}, Object.fromEntries(
      Object.entries({ key: "Enter", defaultPrevented: true, ...modifiers })
        .map(([key, value]) => [key, { get: () => value }]),
    ))) as NodeConfigKeyEvent;
    expect(Object.keys(event)).toEqual([]);
    expect(promptEditorRunShortcutScope(event)).toBe(scope);
    expect(nodeConfigRunShortcutScope(event)).toBeNull();
  });

  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { altKey: true },
    { ctrlKey: false },
    { key: "Escape" },
  ])("never turns an excluded reserved chord into a submission: %j", excluded => {
    expect(promptEditorRunShortcutScope({ ...chord, defaultPrevented: true, ...excluded })).toBeNull();
  });
});

function documentFixture() {
  const cards: HTMLElement[] = [];
  const layers: HTMLElement[] = [];
  const document = {
    querySelectorAll: (selector: string) => selector.startsWith(".node-config-popover") ? cards : layers,
  } as unknown as Document;
  const card = (id: string, options: { childLayer?: boolean; nativeSelect?: boolean } = {}) => {
    const element = {
      ownerDocument: document,
      getAttribute: (name: string) => name === "data-config-node-id" ? id : null,
      querySelector: (selector: string) => selector === "select:open"
        ? options.nativeSelect ? {} : null
        : options.childLayer ? {} : null,
    } as unknown as HTMLElement;
    cards.push(element);
    return element;
  };
  const portal = (ownerId: string) => {
    const element = {
      getAttribute: (name: string) => name === "data-node-config-owner-id" ? ownerId : null,
    } as unknown as HTMLElement;
    layers.push(element);
    return element;
  };
  const target = (owner: HTMLElement | null, linkedLayer: HTMLElement | null = null) => ({
    ownerDocument: document,
    closest: (selector: string) => selector.startsWith(".node-config-popover") ? owner
      : selector === "[data-node-config-owner-id]" ? linkedLayer : null,
  }) as unknown as HTMLElement;
  return { card, portal, target };
}

describe("parameter card child layers", () => {
  it("finds the card by DOM ancestry or the exact owner ID of a detached portal", () => {
    const f = documentFixture();
    const a = f.card("a"), b = f.card('b"[id]');
    expect(nodeConfigOwnerElement(f.target(a))).toBe(a);
    expect(nodeConfigOwnerElement(f.target(null, f.portal('b"[id]')))).toBe(b);
    expect(nodeConfigOwnerElement(f.target(null, f.portal("deleted")))).toBeNull();
    expect(nodeConfigOwnerElement(null)).toBeNull();
  });

  it("lets only this card's marked child layer or native select own Escape", () => {
    const f = documentFixture();
    const plain = f.card("plain"), custom = f.card("custom", { childLayer: true });
    const native = f.card("native", { nativeSelect: true });
    expect(nodeConfigChildLayerOpen(f.target(plain))).toBe(false);
    expect(nodeConfigChildLayerOpen(f.target(custom))).toBe(true);
    expect(nodeConfigChildLayerOpen(f.target(native))).toBe(true);
    f.portal("plain");
    expect(nodeConfigChildLayerOpen(f.target(plain))).toBe(true);
    expect(nodeConfigChildLayerOpen(f.target(f.card("sibling")))).toBe(false);
    expect(nodeConfigChildLayerOpen(null)).toBe(false);
  });
});
