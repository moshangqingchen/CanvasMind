import { describe, expect, it } from "vitest";
import { anchoredSurfacePlacement, appendTypeahead, nextEnabledIndex, typeaheadIndex } from "../components/ui/interactions";

const options = [{ label: "自动" }, { label: "Low", disabled: true }, { label: "High" }, { label: "Highest" }, { label: "Medium" }];

describe("parameter UI keyboard navigation", () => {
  it("cycles selectable rows, skips disabled rows, and reaches Home/End without dropping options", () => {
    expect(nextEnabledIndex(options, 0, "ArrowDown")).toBe(2);
    expect(nextEnabledIndex(options, 2, "ArrowLeft")).toBe(0);
    expect(nextEnabledIndex(options, 0, "ArrowUp")).toBe(4);
    expect(nextEnabledIndex(options, 4, "ArrowRight")).toBe(0);
    expect(nextEnabledIndex(options, 3, "Home")).toBe(0);
    expect(nextEnabledIndex(options, 0, "End")).toBe(4);
    expect(nextEnabledIndex([{ disabled: true }], 0, "ArrowDown")).toBe(-1);
    expect(nextEnabledIndex([], -1, "Home")).toBe(-1);
  });

  it("matches prefixes, cycles repeated letters, and never selects a disabled matching row", () => {
    expect(typeaheadIndex(options, 0, "h")).toBe(2);
    expect(typeaheadIndex(options, 2, "hi")).toBe(2);
    expect(typeaheadIndex(options, 2, "hh")).toBe(3);
    expect(typeaheadIndex(options, 0, "l")).toBe(0);
    expect(typeaheadIndex(options, 3, "m")).toBe(4);
    expect(typeaheadIndex(options, 4, "自动")).toBe(0);
    expect(typeaheadIndex([], -1, "h")).toBe(-1);
  });

  it("expires incomplete typeahead instead of retaining it across later interactions", () => {
    const first = appendTypeahead({ text: "", at: 0 }, "h", 1000);
    expect(appendTypeahead(first, "i", 1200)).toEqual({ text: "hi", at: 1200 });
    expect(appendTypeahead(first, "m", 2000)).toEqual({ text: "m", at: 2000 });
  });
});

describe("parameter UI anchored surface bounds", () => {
  const bounds = { left: 8, right: 412, top: 8, bottom: 712, width: 404 };
  it("places a menu below the anchor and constrains a wide menu to the viewport", () => {
    const placement = anchoredSurfacePlacement({ bounds,
      anchor: { left: 60, right: 420, top: 80, bottom: 118, width: 360 },
      naturalHeight: 260, minWidth: 240, maxWidth: 480 });
    expect(placement).toEqual({ left: 52, top: 124, width: 360, maxHeight: 588 });
    const narrow = anchoredSurfacePlacement({ bounds: { ...bounds, right: 212, width: 204 },
      anchor: { left: 20, right: 200, top: 80, bottom: 118, width: 180 },
      naturalHeight: 260, minWidth: 320, maxWidth: 480 });
    expect(narrow.width).toBe(204);
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(212);
  });

  it("flips a near-bottom anchor upward and gives tall catalogs an internal scroll budget", () => {
    const placement = anchoredSurfacePlacement({ bounds,
      anchor: { left: 20, right: 300, top: 640, bottom: 678, width: 280 },
      naturalHeight: 1200, minWidth: 240, maxWidth: 420 });
    expect(placement.top).toBe(8);
    expect(placement.maxHeight).toBe(626);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(712);
  });

  it("uses the optional side only when it fits the requested minimum and keeps the full viewport height", () => {
    const largeBounds = { ...bounds, right: 1200, width: 1192 };
    const owner = { left: 800, right: 1180, top: 80, bottom: 700, width: 380 };
    const anchor = { left: 1100, right: 1140, top: 600, bottom: 638, width: 40 };
    const placement = anchoredSurfacePlacement({ bounds: largeBounds, anchor, owner,
      naturalHeight: 900, minWidth: 320, maxWidth: 480, preferSidePlacement: true });
    expect(placement).toEqual({ left: 474, top: 8, width: 320, maxHeight: 704 });
    const fallback = anchoredSurfacePlacement({ bounds, anchor: { ...anchor, left: 300, right: 340 },
      owner: { ...owner, left: 20, right: 400, width: 380 }, naturalHeight: 200,
      minWidth: 320, maxWidth: 480, preferSidePlacement: true });
    expect(fallback.left).toBe(92);
    expect(fallback.width).toBe(320);
  });
});
