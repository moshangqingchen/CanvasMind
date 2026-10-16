import { describe, expect, it } from "vitest";
import { selectLibraryRange } from "./library-selection";
describe("library range selection", () => {
  it("selects across unmounted rows in either direction", () => {
    const ids = Array.from({ length: 1000 }, (_, index) => String(index));
    expect([...selectLibraryRange(ids, "5", "400")]).toHaveLength(396);
    expect([...selectLibraryRange(ids, "400", "5")]).toEqual([...selectLibraryRange(ids, "5", "400")]);
  });
  it("does not select unrelated rows after filtering removes the anchor", () => {
    expect([...selectLibraryRange(["a", "b", "c"], "gone", "c")]).toEqual(["c"]);
    expect([...selectLibraryRange(["a", "b", "c"], "b", "c", new Set(["a"]))]).toEqual(["a", "b", "c"]);
  });
});
