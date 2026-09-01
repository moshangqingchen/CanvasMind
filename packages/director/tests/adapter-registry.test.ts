import { describe, expect, it, vi } from "vitest";

import { DirectorAdapterRegistry } from "../src/adapter-registry.js";
import type { DirectorModelAdapter } from "../src/types.js";

function adapter(
  protocol: DirectorModelAdapter["protocol"],
): DirectorModelAdapter {
  return {
    protocol,
    complete: vi.fn(async () => ({ output: {}, sources: [] })),
  };
}

describe("DirectorAdapterRegistry", () => {
  it("resolves adapters by protocol and rejects accidental duplicates", () => {
    const openai = adapter("openai-responses");
    const registry = new DirectorAdapterRegistry([openai]);
    expect(registry.get("openai-responses")).toBe(openai);
    expect(() => registry.register(adapter("openai-responses"))).toThrow(
      "already registered",
    );
    expect(() => registry.get("anthropic-messages")).toThrow(
      "No director adapter",
    );
  });
});
