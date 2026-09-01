import { describe, expect, it } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry, ProviderRegistry } from "./registry.js";

describe("ProviderRegistry", () => {
  it("selects an adapter from the resolved connection provider", async () => {
    const resolver = new StaticConnectionResolver([
      { id: "fake-connection", provider: "fake" },
    ]);
    const registry = createDefaultProviderRegistry(resolver);
    expect(await registry.forConnection("fake-connection")).toBe(
      registry.get("fake"),
    );
    expect(registry.get("weai")).toBeDefined();
  });

  it("allows an application-specific adapter to override a built-in", () => {
    const resolver = new StaticConnectionResolver([]);
    const adapter = {
      testConnection: async () => undefined,
      listModels: async () => [],
      validate: async () => ({ valid: true, issues: [] }),
      submit: async () => ({
        providerTaskId: "x",
        status: "succeeded" as const,
      }),
      extractOutputs: async () => [],
    };
    const registry = new ProviderRegistry(resolver, { custom: adapter });
    expect(registry.get("custom")).toBe(adapter);
    const defaults = createDefaultProviderRegistry(resolver, {
      adapters: { fake: adapter },
    });
    expect(defaults.get("fake")).toBe(adapter);
  });
});
