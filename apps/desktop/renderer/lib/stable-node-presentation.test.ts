import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../components/types";
import { createStableNodePresentationData } from "./stable-node-presentation";

function node(id: string, model = "model-a", onModelChange: (value: string) => void = () => {}): CanvasNode {
  return { id, type: "workflow", position: { x: 0, y: 0 }, data: { label: id,
    connectionId: id.startsWith("a") ? "connection-a" : "connection-b", model,
    modelOptions: [{ id: model, name: model, operations: ["image.generate"] }],
    linkedAssets: [], compatibleInputIds: [], onModelChange } };
}

describe("stable per-node presentation", () => {
  it("retains all 120 node data identities when a scan rebuilds equal presentation fields", () => {
    const cache = createStableNodePresentationData();
    const first = cache.prepare(Array.from({ length: 120 }, (_, index) => node(`a${index}`)));
    cache.commit(first);
    const second = cache.prepare(Array.from({ length: 120 }, (_, index) => node(`a${index}`)));
    cache.commit(second);
    for (let index = 0; index < first.nodes.length; index++) expect(second.nodes[index]!.data).toBe(first.nodes[index]!.data);
    expect(cache.size).toBe(120);
  });

  it("updates only the connection whose displayed model changes, preserving scan state changes", () => {
    const cache = createStableNodePresentationData();
    const first = cache.prepare([node("a"), node("b")]); cache.commit(first);
    const a = node("a", "model-new");
    a.data.modelOptionsAuthoritative = true;
    const second = cache.prepare([a, node("b")]); cache.commit(second);
    expect(second.nodes[0]!.data).not.toBe(first.nodes[0]!.data);
    expect(second.nodes[0]!.data.modelOptionsAuthoritative).toBe(true);
    expect(second.nodes[1]!.data).toBe(first.nodes[1]!.data);
    const pending = cache.prepare([{ ...a, data: { ...a.data, modelOptionsLoading: true } }, node("b")]);
    expect(pending.nodes[0]!.data.modelOptionsLoading).toBe(true);
    expect(pending.nodes[0]!.data).not.toBe(second.nodes[0]!.data);
  });

  it("keeps callback identity but invokes the latest committed closure, never an abandoned render", () => {
    const cache = createStableNodePresentationData();
    const calls: string[] = [];
    const first = cache.prepare([node("a", "model-a", value => { calls.push(`old:${value}`); })]); cache.commit(first);
    const action = first.nodes[0]!.data.onModelChange!;
    const second = cache.prepare([node("a", "model-a", value => { calls.push(`new:${value}`); })]);
    expect(second.nodes[0]!.data.onModelChange).toBe(action);
    action("before-commit"); cache.commit(second); action("after-commit");
    cache.prepare([node("a", "model-a", value => { calls.push(`abandoned:${value}`); })]);
    action("after-abandoned-render");
    expect(calls).toEqual(["old:before-commit", "new:after-commit", "new:after-abandoned-render"]);
  });

  it("preserves real parameter and callback removal changes and prunes deleted nodes", () => {
    const cache = createStableNodePresentationData();
    const a = node("a"); a.data.parameters = { quality: "high", width: 1024 };
    const first = cache.prepare([a, node("b")]); cache.commit(first);
    const changed = { ...a, data: { ...a.data, parameters: { quality: "max", width: 2048 } } };
    delete changed.data.onModelChange;
    const second = cache.prepare([changed]); cache.commit(second);
    expect(second.nodes[0]!.data.parameters).toEqual({ quality: "max", width: 2048 });
    expect(second.nodes[0]!.data.onModelChange).toBeUndefined();
    expect(cache.size).toBe(1);
    cache.commit(cache.prepare([])); expect(cache.size).toBe(0);
  });

  it("clears removed/canvas-unmounted closures and treats opaque values by identity", () => {
    const cache = createStableNodePresentationData();
    const calls: string[] = [];
    const a = node("a", "model-a", value => { calls.push(value); });
    a.data.parameters = { opaque: new Date(0) };
    const first = cache.prepare([a]); cache.commit(first);
    const action = first.nodes[0]!.data.onModelChange!;
    const second = cache.prepare([{ ...a, data: { ...a.data, parameters: { opaque: new Date(1) } } }]); cache.commit(second);
    expect(second.nodes[0]!.data.parameters).not.toBe(first.nodes[0]!.data.parameters);
    cache.commit(cache.prepare([])); action("removed");
    expect(calls).toEqual([]);
    const third = cache.prepare([a]); cache.commit(third);
    const newAction = third.nodes[0]!.data.onModelChange!;
    newAction("live"); cache.clear(); newAction("unmounted");
    expect(cache.size).toBe(0);
    expect(calls).toEqual(["live"]);
  });
});
