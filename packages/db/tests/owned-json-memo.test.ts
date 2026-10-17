import { describe, expect, it } from "vitest";
import { OwnedJsonMemo } from "../src/owned-json-memo.js";

describe("owned row JSON memo", () => {
  it("reuses an owned revision and replaces the slot when the revision changes", () => {
    const memo = new OwnedJsonMemo();
    let reads = 0;
    const first = { toJSON: () => { reads++; return { price: 1 }; } };
    expect(memo.stringify("connection:one", first)).toBe('{"price":1}');
    expect(memo.stringify("connection:one", first)).toBe('{"price":1}');
    expect(reads).toBe(1);
    const next = { price: 2 };
    expect(memo.stringify("connection:one", next)).toBe('{"price":2}');
    // A failed candidate can be serialized without publishing it. Returning to
    // the original owned revision must not retain the rejected candidate JSON.
    expect(memo.stringify("connection:one", first)).toBe('{"price":1}');
    expect(reads).toBe(2);
  });

  it("bounds entries and bytes without changing JSON semantics", () => {
    const memo = new OwnedJsonMemo(1, 128);
    let reads = 0;
    const first = { toJSON: () => { reads++; return ["a"]; } };
    memo.stringify("a", first);
    memo.stringify("b", { nested: true });
    memo.stringify("a", first);
    expect(reads).toBe(2);
    const oversized = { toJSON: () => { reads++; return "x".repeat(100); } };
    memo.stringify("large", oversized);
    memo.stringify("large", oversized);
    expect(reads).toBe(4);
    expect(memo.stringify("empty", undefined)).toBeUndefined();
    expect(memo.stringify("nullable", null)).toBe("null");
    expect(memo.stringify("string", "中文")).toBe('"中文"');
  });
});
