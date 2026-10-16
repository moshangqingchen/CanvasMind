import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ImageEditingConnection } from "@super-canvas/providers/image-editing-capabilities";
import { createModelImageCapabilityCache } from "./model-image-capability-cache";

const model: ModelDescriptor = { id: "image", name: "Image", operations: ["image.generate", "image.edit"] };
const connection: ImageEditingConnection = { provider: "fake", config: { modelGroup: "A" } };

describe("per-pass image capability presentation cache", () => {
  it("computes the shared descriptor's defaults once for many empty node parameter objects", () => {
    const compute = vi.fn(() => ({ transparent: false, mask: null }));
    const cache = createModelImageCapabilityCache(compute);
    const first = cache(connection, model);
    for (let index = 0; index < 40; index++) expect(cache(connection, model, {})).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("keeps exact connection, complete descriptor and operation identities separate", () => {
    const compute = vi.fn(() => ({ transparent: false, mask: null }));
    const cache = createModelImageCapabilityCache(compute);
    const original = cache(connection, model);
    const sources = [
      cache({ ...connection, config: { modelGroup: "B" } }, model),
      cache(connection, { ...model, id: "image-2" }),
      cache(connection, { ...model, metadata: { supportsImageEdit: false } }),
      cache(connection, { ...model, parameters: [{ key: "quality", label: "质量", control: "select", default: "high" }] }),
      cache(connection, model, undefined, "image.edit"),
    ];
    for (const result of sources) expect(result).not.toBe(original);
    expect(compute).toHaveBeenCalledTimes(6);
  });

  it("shares complete primitive values irrespective of object identity and field order", () => {
    const compute = vi.fn(() => ({ transparent: false, mask: null }));
    const cache = createModelImageCapabilityCache(compute);
    const parameters = { quality: "max", n: 1, reference: undefined };
    const first = cache(connection, model, parameters);
    expect(cache(connection, model, parameters)).toBe(first);
    for (let index = 0; index < 40; index++)
      expect(cache(connection, model, { reference: undefined, n: 1, quality: "max" })).toBe(first);
    expect(cache(connection, model, Object.assign(Object.create(null), parameters))).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cache(connection, model, { quality: "max", n: 1 })).not.toBe(first);
    expect(cache(connection, model, { reference: undefined })).not.toBe(cache(connection, model, {}));
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it("separates primitive types, explicit undefined, negative zero and non-finite numbers", () => {
    const compute = vi.fn(() => ({ transparent: false, mask: null }));
    const cache = createModelImageCapabilityCache(compute);
    const values = [undefined, null, "undefined", "null", 0, -0, 1, "1", true, "true", false, NaN, Infinity, -Infinity, "NaN", "Infinity"];
    const results = values.map(value => cache(connection, model, { value }));
    expect(new Set(results).size).toBe(values.length);
    for (let index = 0; index < values.length; index++)
      expect(cache(connection, model, { value: values[index] })).toBe(results[index]);
    expect(cache(connection, model, {})).not.toBe(results[0]);
    expect(compute).toHaveBeenCalledTimes(values.length + 1);
  });

  it("uses object identity for nested values without joining distinct outer objects", () => {
    const compute = vi.fn(() => ({ transparent: false, mask: null }));
    const cache = createModelImageCapabilityCache(compute);
    const nested = { ratio: "16:9" };
    const parameters = { custom: nested };
    const first = cache(connection, model, parameters);
    expect(cache(connection, model, parameters)).toBe(first);
    expect(cache(connection, model, { custom: nested })).not.toBe(first);
    expect(cache(connection, model, { custom: { ratio: "16:9" } })).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("does not read accessors or merge symbols, hidden fields and non-plain objects", () => {
    const compute = vi.fn(() => ({ transparent: false, mask: null }));
    const cache = createModelImageCapabilityCache(compute);
    const getter = vi.fn(() => "max");
    const accessor = () => Object.defineProperty({}, "quality", { get: getter, enumerable: true });
    const hidden = () => Object.defineProperty({}, "quality", { value: "max" });
    class ParameterObject { quality = "max"; }
    const symbol = Symbol("quality");
    for (const build of [accessor, hidden, () => ({ [symbol]: "max" }), () => new ParameterObject(), () => ({ custom: BigInt(1) })]) {
      const parameters = build();
      const first = cache(connection, model, parameters);
      expect(cache(connection, model, parameters)).toBe(first);
      expect(cache(connection, model, build())).not.toBe(first);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(compute).toHaveBeenCalledTimes(10);
  });

  it("reads fresh evidence in each new presentation pass", () => {
    const compute = vi.fn(() => ({ transparent: false, mask: null }));
    const first = createModelImageCapabilityCache(compute)(connection, model);
    expect(createModelImageCapabilityCache(compute)(connection, model)).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
