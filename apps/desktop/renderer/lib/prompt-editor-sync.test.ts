import React, { type EffectCallback } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import type { PromptPart } from "@super-canvas/core";

// Node-only component boundary test. The actual PromptEditor effects, refs,
// debounce and blur callbacks execute; only React's hook host and Tiptap DOM
// boundary are replaced. No browser, DOM package or test-only app route needed.
type Slot = { ref?: { current: unknown }; dependencies?: readonly unknown[]; value?: unknown; cleanup?: () => void };
type Handlers = { ref: { current: HTMLDivElement | null }; onFocus?: () => void; onCompositionStart?: () => void; onBlur: () => void };
const slots: Slot[] = [];
let cursor = 0;
let effects: Array<() => void> = [];
let handlers: Handlers;
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) =>
  Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
const nextSlot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
const documentFor = (text: string): JSONContent => ({ type: "doc", content: [{ type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}) }] });

class EditorBoundary {
  static instances: EditorBoundary[] = [];
  isDestroyed = false;
  isFocused = false;
  private content: JSONContent;
  readonly view = { dom: { setAttribute: vi.fn() } };
  readonly commands = {
    focus: vi.fn(() => { this.isFocused = true; return true; }),
    setContent: vi.fn((content: JSONContent, options: { emitUpdate?: boolean } = {}) => {
      this.content = structuredClone(content);
      if (options.emitUpdate !== false) this.options.onUpdate({ editor: this });
      return true;
    }),
  };
  constructor(private readonly options: { content: JSONContent; onUpdate: (value: { editor: EditorBoundary }) => void }) {
    this.content = structuredClone(options.content);
    EditorBoundary.instances.push(this);
  }
  get isEmpty() { return !this.content.content?.[0]?.content?.length; }
  getJSON() { return structuredClone(this.content); }
  mount() { return this; }
  destroy() { this.isDestroyed = true; }
  input(text: string) { this.content = documentFor(text); this.options.onUpdate({ editor: this }); }
}

let PromptEditor: typeof import("../components/prompt-editor").PromptEditor;
type Props = Parameters<typeof import("../components/prompt-editor").PromptEditor>[0];

function render(props: Props) {
  cursor = 0;
  effects = [];
  handlers = PromptEditor(props).props as Handlers;
  handlers.ref.current ??= {} as HTMLDivElement;
  for (const effect of effects) effect();
  return EditorBoundary.instances[0]!;
}

function focus(editor: EditorBoundary) { editor.isFocused = true; handlers.onFocus?.(); }
function blur(editor: EditorBoundary) { editor.isFocused = false; handlers.onBlur(); }
const partsFor = (text: string): PromptPart[] => [{ type: "text", text }];

beforeAll(async () => {
  vi.doMock("react", async () => ({
    ...await vi.importActual<typeof import("react")>("react"),
    useRef: (current: unknown) => { const slot = nextSlot(); return slot.ref ??= { current }; },
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
      const slot = nextSlot();
      if (!sameDependencies(slot.dependencies, dependencies)) {
        slot.value = callback; slot.dependencies = [...dependencies];
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
  vi.doMock("@tiptap/core", () => ({ Editor: EditorBoundary, Extension: { create: (value: unknown) => value } }));
  vi.doMock("@tiptap/starter-kit", () => ({ default: { configure: () => ({}) } }));
  vi.doMock("@tiptap/extension-mention", () => ({ default: { extend: () => ({ configure: () => ({}) }) } }));
  ({ PromptEditor } = await import("../components/prompt-editor"));
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  slots.length = 0; effects = []; EditorBoundary.instances = [];
});

afterEach(() => {
  for (const slot of slots) slot.cleanup?.();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("PromptEditor external parts and blur", () => {
  it("shows the latest deferred external text on blur when focus had no local edit, without writing old text back", () => {
    const onChange = vi.fn();
    const props: Props = { parts: partsFor("initial"), assets: [], onChange };
    const editor = render(props);
    focus(editor);
    render({ ...props, parts: partsFor("external first") });
    render({ ...props, parts: partsFor("external latest") });
    expect(editor.getJSON()).toEqual(documentFor("initial"));
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    blur(editor);
    expect(editor.getJSON()).toEqual(documentFor("external latest"));
    expect(editor.commands.setContent).toHaveBeenCalledTimes(1);
    expect(editor.commands.setContent).toHaveBeenCalledWith(documentFor("external latest"), { emitUpdate: false });
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a local self-echo from replacing the focused editor or publishing duplicate changes on blur", () => {
    const onChange = vi.fn();
    const props: Props = { parts: partsFor("initial"), assets: [], onChange };
    const editor = render(props);
    focus(editor);
    editor.input("local accepted");
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(partsFor("local accepted"));
    render({ ...props, parts: structuredClone(partsFor("local accepted")) });
    blur(editor);
    expect(editor.getJSON()).toEqual(documentFor("local accepted"));
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("flushes the final local input on blur without reverting to an earlier self-echo prop", () => {
    const onChange = vi.fn();
    const props: Props = { parts: partsFor("initial"), assets: [], onChange };
    const editor = render(props);
    focus(editor);
    editor.input("earlier local");
    vi.advanceTimersByTime(250);
    render({ ...props, parts: partsFor("earlier local") });
    editor.input("final local");
    render({ ...props, parts: structuredClone(partsFor("earlier local")) });
    blur(editor);
    expect(editor.getJSON()).toEqual(documentFor("final local"));
    expect(onChange.mock.calls.map(([parts]) => parts)).toEqual([partsFor("earlier local"), partsFor("final local")]);
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("continues synchronizing unfocused external updates silently and ignores equal documents", () => {
    const onChange = vi.fn();
    const props: Props = { parts: partsFor("initial"), assets: [], onChange };
    const editor = render(props);
    render({ ...props, parts: partsFor("external") });
    render({ ...props, parts: structuredClone(partsFor("external")) });
    expect(editor.getJSON()).toEqual(documentFor("external"));
    expect(editor.commands.setContent).toHaveBeenCalledTimes(1);
    expect(editor.commands.setContent).toHaveBeenCalledWith(documentFor("external"), { emitUpdate: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves an uncommitted IME composition on blur instead of applying external props or publishing old text", () => {
    const onChange = vi.fn();
    const props: Props = { parts: partsFor("initial"), assets: [], onChange };
    const editor = render(props);
    focus(editor);
    handlers.onCompositionStart?.();
    render({ ...props, parts: partsFor("external while composing") });
    blur(editor);
    expect(editor.getJSON()).toEqual(documentFor("initial"));
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["before", "after"] as const)("flushes the final IME transaction when composition finishes %s blur", order => {
    const onChange = vi.fn();
    const props: Props = { parts: partsFor("initial"), assets: [], onChange };
    const editor = render(props);
    focus(editor);
    handlers.onCompositionStart?.();
    render({ ...props, parts: partsFor("external while composing") });
    if (order === "before") editor.input("中文最终输入");
    blur(editor);
    if (order === "after") editor.input("中文最终输入");
    vi.advanceTimersByTime(250);
    expect(editor.getJSON()).toEqual(documentFor("中文最终输入"));
    expect(editor.commands.setContent).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(partsFor("中文最终输入"));
    render({ ...props, parts: partsFor("中文最终输入") });
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
