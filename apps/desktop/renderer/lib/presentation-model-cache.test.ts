import { describe, expect, it, vi } from "vitest";
import { createPresentationModelCache } from "./presentation-model-cache";

describe("presentation snapshot cache", () => {
  it("shares descriptors across panel renders for the same immutable record", () => {
    const derive = vi.fn((record: { models: string[] }) => record.models.map(id => ({ id })));
    const resolve = createPresentationModelCache(derive);
    const record = { models: ["image-a"] };
    const initial = resolve(record);
    expect(resolve(record)).toBe(initial);
    expect(derive).toHaveBeenCalledTimes(1);
    const refreshed = { models: ["image-a", "image-b"] };
    expect(resolve(refreshed)).toEqual([{ id: "image-a" }, { id: "image-b" }]);
    expect(derive).toHaveBeenCalledTimes(2);
  });

  it("a new verification scope recomputes even for an unchanged connection record", () => {
    let revision = 1;
    const record = { id: "connection" };
    const first = createPresentationModelCache(() => ({ revision }));
    expect(first(record).revision).toBe(1);
    revision = 2;
    const next = createPresentationModelCache(() => ({ revision }));
    expect(next(record).revision).toBe(2);
    expect(next(record)).toBe(next(record));
    expect(first(record).revision).toBe(1);
  });

  it("caches empty results and retries projections that throw", () => {
    const record = {};
    const empty = vi.fn(() => undefined);
    const resolveEmpty = createPresentationModelCache(empty);
    expect(resolveEmpty(record)).toBeUndefined();
    expect(resolveEmpty(record)).toBeUndefined();
    expect(empty).toHaveBeenCalledTimes(1);
    const derive = vi.fn<(_: object) => string>().mockImplementationOnce(() => { throw new Error("retry"); }).mockReturnValue("ready");
    const resolve = createPresentationModelCache(derive);
    expect(() => resolve(record)).toThrow("retry");
    expect(resolve(record)).toBe("ready");
    expect(resolve(record)).toBe("ready");
    expect(derive).toHaveBeenCalledTimes(2);
  });
});
