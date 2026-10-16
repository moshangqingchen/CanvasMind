import { describe, expect, it } from "vitest";
import { memoryInputCountsChanged, readMemoryInputCounts } from "../e2e/helpers/p0-memory-idle-input";

const zero = { pointerDown: 0, wheel: 0, keyDown: 0, untrusted: 0 };

describe("P0 idle input evidence", () => {
  it("accepts unchanged scalar counters and discards any unrelated fields", () => {
    const counters = readMemoryInputCounts({ visibility: { input: { ...zero, ignored: "never copied" } } });
    expect(counters).toEqual(zero);
    expect(memoryInputCountsChanged(zero, counters!)).toBe(false);
  });
  it.each(["pointerDown", "wheel", "keyDown", "untrusted"] as const)("invalidates a change to %s", key => {
    expect(memoryInputCountsChanged(zero, { ...zero, [key]: 1 })).toBe(true);
  });
  it("detects reset/decreased counters and missing or malformed evidence", () => {
    expect(memoryInputCountsChanged({ ...zero, wheel: 2 }, zero)).toBe(true);
    for (const sample of [undefined, {}, { visibility: {} }, { visibility: { input: {} } },
      { visibility: { input: { ...zero, wheel: -1 } } }, { visibility: { input: { ...zero, wheel: NaN } } }])
      expect(readMemoryInputCounts(sample)).toBeNull();
  });
});
