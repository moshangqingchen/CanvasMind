import { afterEach, describe, expect, it, vi } from "vitest";
import { CANVAS_ARRANGEMENT_ORDER_KEY, orderedIncomingCanvasEdges, readCanvasArrangementOrder,
  sortCanvasArrangementItems, writeCanvasArrangementOrder } from "./canvas-arrangement";

afterEach(() => vi.unstubAllGlobals());

describe("canvas arrangement order", () => {
  it("naturally sorts file names without changing the original selection", () => {
    const names = ["10.png", "2.png", "1.png", "素材12.png", "素材3.png"];
    expect(sortCanvasArrangementItems(names, "filename", name => name))
      .toEqual(["1.png", "2.png", "10.png", "素材3.png", "素材12.png"]);
    expect(sortCanvasArrangementItems(names, "connection", name => name)).toEqual(names);
    expect(names[0]).toBe("10.png");
  });

  it("keeps equal names in their incoming connection order", () => {
    const items = [{ id: "b", name: "same.png" }, { id: "a", name: "Same.png" }];
    expect(sortCanvasArrangementItems(items, "filename", item => item.name, item => item.id)).toEqual(items);
    const edges = [{ source: "z", target: "other" }, ...items.map(item => ({ source: item.id, target: "target" }))];
    expect(orderedIncomingCanvasEdges("target", edges).map(edge => edge.source)).toEqual(["b", "a"]);
  });

  it("defaults to file names and persists a valid preference locally", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value) } });
    expect(readCanvasArrangementOrder()).toBe("filename");
    expect(writeCanvasArrangementOrder("connection")).toBe(true);
    expect(values.get(CANVAS_ARRANGEMENT_ORDER_KEY)).toBe("connection");
    expect(readCanvasArrangementOrder()).toBe("connection");
    values.set(CANVAS_ARRANGEMENT_ORDER_KEY, "old-order");
    expect(readCanvasArrangementOrder()).toBe("filename");
  });

  it("ignores unavailable browser storage for both reads and writes", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("blocked"); } });
    expect(readCanvasArrangementOrder()).toBe("filename");
    expect(writeCanvasArrangementOrder("connection")).toBe(false);
    vi.stubGlobal("window", undefined);
    expect(readCanvasArrangementOrder()).toBe("filename");
    expect(writeCanvasArrangementOrder("filename")).toBe(false);
  });
});
