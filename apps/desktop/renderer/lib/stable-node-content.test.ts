import { describe, expect, it } from "vitest";
import type { AssetView, CanvasNode } from "../components/types";
import { createNodePresentationCache, nodeDefinitionsEqual } from "./stable-node-content";

function node(id: string): CanvasNode {
  return { id, type: "workflow", position: { x: 0, y: 0 }, data: { label: id } };
}

function asset(kind: AssetView["kind"]): AssetView {
  return { id: kind, name: kind, kind, mimeType: `${kind}/example`, size: 1,
    storageKey: kind, metadata: {}, createdAt: "2026-10-15T00:00:00.000Z" };
}

describe("canvas node definitions", () => {
  it("ignores geometry and selection while retaining data, type, order and deletion changes", () => {
    const a = node("a"), b = node("b");
    const geometryAndSelection = { ...a, selected: true, dragging: true,
      position: { x: 100, y: 120 }, measured: { width: 380, height: 200 }, style: { width: 400 } };
    expect(nodeDefinitionsEqual([a, b], [geometryAndSelection, b])).toBe(true);
    expect(nodeDefinitionsEqual([a, b], [{ ...a, data: { ...a.data, model: "new-model" } }, b])).toBe(false);
    expect(nodeDefinitionsEqual([a, b], [{ ...a, data: { ...a.data } }, b])).toBe(false);
    expect(nodeDefinitionsEqual([a, b], [{ ...a, type: "other" }, b])).toBe(false);
    expect(nodeDefinitionsEqual([a, b], [b, a])).toBe(false);
    expect(nodeDefinitionsEqual([a, b], [a])).toBe(false);
  });
});

describe("canvas node presentation cache", () => {
  it("selects one node without replacing unselected data, then changes only A/B when selection moves", () => {
    const present = createNodePresentationCache();
    const a = node("a"), b = node("b"), c = node("c");
    const base = new Map([a, b, c].map(item => [item.id, item.data]));
    const before = present([a, b, c], base, { size: 0, anchorId: null });
    const selectedA = { ...a, selected: true };
    const first = present([selectedA, b, c], base, { size: 1, anchorId: null });
    expect(first[0]?.data).not.toBe(before[0]?.data);
    expect(first[0]?.data.selectionSize).toBe(1);
    expect(first[1]).toBe(before[1]);
    expect(first[2]).toBe(before[2]);
    const second = present([a, { ...b, selected: true }, c], base, { size: 1, anchorId: null });
    expect(second[0]?.data).toBe(a.data);
    expect(second[0]?.data).not.toBe(first[0]?.data);
    expect(second[1]?.data).not.toBe(first[1]?.data);
    expect(second[2]).toBe(first[2]);
    expect(a.data.selectionSize).toBeUndefined();
    expect(b.data.selectionSize).toBeUndefined();
  });

  it("updates two-to-three selected nodes and their anchor without changing unrelated data", () => {
    const present = createNodePresentationCache();
    const a = { ...node("a"), selected: true }, b = { ...node("b"), selected: true };
    const c = node("c"), d = node("d");
    const base = new Map([a, b, c, d].map(item => [item.id, item.data]));
    const align = () => {};
    const two = present([a, b, c, d], base, { size: 2, anchorId: "b", onAlignSelection: align });
    expect(two[1]?.data).toMatchObject({ selectionSize: 2, selectionCount: 2, selectionAlignmentVisible: true });
    expect(two[1]?.data.onAlignSelection).toBe(align);
    const three = present([a, b, { ...c, selected: true }, d], base, { size: 3, anchorId: "c", onAlignSelection: align });
    for (const index of [0, 1, 2]) {
      expect(three[index]?.data).not.toBe(two[index]?.data);
      expect(three[index]?.data.selectionSize).toBe(3);
    }
    expect(three[1]?.data.selectionAlignmentVisible).toBe(false);
    expect(three[1]?.data.selectionCount).toBeUndefined();
    expect(three[1]?.data.onAlignSelection).toBeUndefined();
    expect(three[2]?.data).toMatchObject({ selectionCount: 3, selectionAlignmentVisible: true });
    expect(three[3]).toBe(two[3]);
    const reanchored = present([a, b, { ...c, selected: true }, d], base,
      { size: 3, anchorId: "b", onAlignSelection: align });
    expect(reanchored[0]?.data).toBe(three[0]?.data);
    expect(reanchored[1]?.data).not.toBe(three[1]?.data);
    expect(reanchored[1]?.data.selectionAlignmentVisible).toBe(true);
    expect(reanchored[2]?.data).not.toBe(three[2]?.data);
    expect(reanchored[2]?.data.selectionAlignmentVisible).toBe(false);
    expect(reanchored[3]).toBe(three[3]);
  });

  it("keeps selected data during geometry changes and refreshes model data and callbacks", () => {
    const present = createNodePresentationCache();
    const selected = { ...node("selected"), selected: true };
    const originalAlign = () => {}, changedAlign = () => {};
    const originalChange = () => {}, changedChange = () => {};
    const originalData = { ...selected.data, model: "old-model", onModelChange: originalChange };
    const selection = { size: 2, anchorId: selected.id, onAlignSelection: originalAlign };
    const first = present([selected], new Map([[selected.id, originalData]]), selection)[0]!;
    const moved = { ...selected, position: { x: 140, y: 240 }, dragging: true };
    const geometry = present([moved], new Map([[selected.id, originalData]]), selection)[0]!;
    expect(geometry.data).toBe(first.data);
    expect(geometry.position).toEqual({ x: 140, y: 240 });
    expect(geometry.dragging).toBe(true);
    const nextData = { ...originalData, model: "new-model", onModelChange: changedChange };
    const refreshed = present([moved], new Map([[selected.id, nextData]]), selection)[0]!;
    expect(refreshed.data).not.toBe(geometry.data);
    expect(refreshed.data.model).toBe("new-model");
    expect(refreshed.data.onModelChange).toBe(changedChange);
    const scannedData = { ...nextData, modelOptionsAuthoritative: true, modelOptionsLoading: false };
    const scanned = present([moved], new Map([[selected.id, scannedData]]), selection)[0]!;
    expect(scanned.data).not.toBe(refreshed.data);
    expect(scanned.data.model).toBe("new-model");
    expect(scanned.data.modelOptionsAuthoritative).toBe(true);
    const callback = present([moved], new Map([[selected.id, scannedData]]), { ...selection, onAlignSelection: changedAlign })[0]!;
    expect(callback.data).not.toBe(scanned.data);
    expect(callback.data.onAlignSelection).toBe(changedAlign);
    expect(present([moved], new Map([[selected.id, scannedData]]), { ...selection, onAlignSelection: changedAlign })[0]).toBe(callback);
  });

  it("clears selection metadata on deselection and drops deleted nodes from the selection cache", () => {
    const present = createNodePresentationCache();
    const a = node("a"), selected = { ...a, selected: true };
    const base = new Map([[a.id, a.data]]);
    const selection = { size: 2, anchorId: a.id, onAlignSelection: () => {} };
    const first = present([selected], base, selection)[0]!;
    const unselected = present([a], base, { size: 0, anchorId: null })[0]!;
    expect(unselected.data).toBe(a.data);
    for (const key of ["selectionSize", "selectionAlignmentVisible", "selectionCount", "onAlignSelection"]) {
      expect(Object.hasOwn(unselected.data, key)).toBe(false);
    }
    const selectedAgain = present([selected], base, selection)[0]!;
    expect(selectedAgain.data).not.toBe(first.data);
    expect(present([], base, selection)).toEqual([]);
    const reinserted = present([selected], base, selection)[0]!;
    expect(reinserted.data).not.toBe(selectedAgain.data);
    expect(reinserted.data.selectionAlignmentVisible).toBe(true);
    // Omitting the new optional argument retains the original two-argument API.
    expect(present([selected], base)[0]?.data).toBe(a.data);
  });

  it("derives reference and mask selectors from the presented inputs rather than the saved node", () => {
    const present = createNodePresentationCache();
    const source: CanvasNode = { ...node("edit"), className: "user-note",
      data: { label: "edit", nodeType: "image-generation" } };
    const data = { ...source.data, linkedAssets: [asset("audio"), asset("image")],
      parameters: { maskAssetId: "mask" } };
    const rendered = present([source], new Map([[source.id, data]]))[0]!;
    expect(rendered.className?.split(" ")).toContain("canvas-node-has-image-reference");
    expect(rendered.className?.split(" ")).toContain("canvas-node-mask-edit");
    expect(rendered.data).toBe(data);
    expect(source.className).toBe("user-note");
    expect(source.data.linkedAssets).toBeUndefined();
    expect(source.data.parameters).toBeUndefined();

    const cleared = present([source], new Map([[source.id, { ...data,
      linkedAssets: [asset("audio")], parameters: { maskAssetId: " ", mask: "" } }]]))[0]!;
    expect(cleared.className).toBe("user-note canvas-node-image-generation");
  });

  it("keeps the image-only selector predicates consistent with legacy masks and non-image nodes", () => {
    const present = createNodePresentationCache();
    const image: CanvasNode = { ...node("image"), data: { label: "image", nodeType: "image-generation",
      parameters: { mask: "https://example.invalid/mask.png" } } };
    expect(present([image], new Map())[0]?.className).toBe("canvas-node-image-generation canvas-node-mask-edit");
    for (const nodeType of ["video-generation", "music-generation", "asset-input", "prompt"] as const) {
      const other: CanvasNode = { ...node(nodeType), data: { ...image.data, nodeType,
        linkedAssets: [asset("image")] } };
      expect(present([other], new Map())[0]?.className).toBe(`canvas-node-${nodeType}`);
    }
  });

  it("moves structural size selectors to the outer node without mutating saved classes or geometry", () => {
    const present = createNodePresentationCache();
    const source: CanvasNode = { ...node("result"), className: "user-note", data: { label: "result", nodeType: "asset-input", generatedResult: true, generatedStatus: "failed" } };
    const failed = present([source], new Map())[0]!;
    expect(failed.className).toBe("user-note canvas-node-asset-input canvas-node-result canvas-node-result-problem");
    const done = present([source], new Map([[source.id, { ...source.data, generatedStatus: "succeeded" }]]))[0]!;
    expect(done.className).toBe("user-note canvas-node-asset-input canvas-node-result");
    expect(source.className).toBe("user-note");
    expect(done.position).toBe(source.position);
  });
  it("keeps untouched nodes stable while preserving the dragged node's latest geometry", () => {
    const present = createNodePresentationCache();
    const a = node("a"), b = node("b");
    const data = new Map([[a.id, { ...a.data, status: "running" as const }]]);
    const before = present([a, b], data);
    const moved = { ...a, position: { x: 80, y: 120 }, dragging: true };
    const after = present([moved, b], data);

    expect(after[0]?.position).toEqual({ x: 80, y: 120 });
    expect(after[0]?.dragging).toBe(true);
    expect(after[0]?.data).toBe(before[0]?.data);
    expect(after[1]).toBe(before[1]);
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.data.status).toBeUndefined();
  });

  it("refreshes callbacks and result state even when source geometry is unchanged", () => {
    const present = createNodePresentationCache();
    const source = node("a");
    const running = { ...source.data, status: "running" as const };
    const ready = { ...source.data, status: "succeeded" as const, assetId: "result-1" };
    const before = present([source], new Map([[source.id, running]]));
    const after = present([source], new Map([[source.id, ready]]));

    expect(after[0]).not.toBe(before[0]);
    expect(after[0]?.data).toBe(ready);
    expect(present([source], new Map([[source.id, ready]]))[0]).toBe(after[0]);
    expect(present([source], new Map())[0]?.data).toBe(source.data);
  });
});
