import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import {
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionUsage,
  providerGroupLabel,
  providerSupplierLabel,
} from "./provider-connection-options";

function connection(
  provider: string,
  config: Record<string, unknown>,
): ProviderConnectionView {
  return {
    id: crypto.randomUUID(),
    name: "测试连接",
    provider,
    config,
    apiKeySet: true,
    apiKey: "",
  };
}

describe("provider connection navigation", () => {
  it("uses the configured Cangyuan preset as the visible supplier", () => {
    const item = connection("rest", {
      preset: "cangyuan-gpt-image-2",
      modelGroup: "IMAGE",
    });

    expect(providerConnectionSupplierKey(item)).toBe("cangyuan");
    expect(providerSupplierLabel("cangyuan")).toBe("沧元算力");
    expect(providerConnectionGroup(item)).toBe("IMAGE");
    expect(providerConnectionUsage(item)).toBe("canvas");
  });

  it("keeps generic providers separate and supplies a default group", () => {
    const item = connection("rest", {});

    expect(providerConnectionSupplierKey(item)).toBe("rest");
    expect(providerSupplierLabel("rest")).toBe("通用 REST");
    expect(providerConnectionGroup(item)).toBe("默认群组");
  });

  it("groups custom OpenAI-compatible connections under their configured supplier", () => {
    const item = connection("openai", {
      supplierKey: "个人Gpt",
      modelGroup: "导演台对话",
      usage: "agent",
    });

    expect(providerConnectionSupplierKey(item)).toBe("个人Gpt");
    expect(providerSupplierLabel("个人Gpt")).toBe("个人Gpt");
    expect(providerConnectionGroup(item)).toBe("导演台对话");
  });

  it("keeps director connections separate from legacy canvas connections", () => {
    const item = connection("rest", {
      preset: "cangyuan-gpt-image-2",
      modelGroup: "LLM-GPT-pro",
      usage: "agent",
    });

    expect(providerConnectionGroup(item)).toBe("LLM-GPT-pro");
    expect(providerConnectionUsage(item)).toBe("agent");
  });

  it("shows live group ratios without changing the stored group value", () => {
    expect(providerGroupLabel("LLM-GPT-plus", 0.075)).toBe(
      "LLM-GPT-plus（x0.075）",
    );
    expect(providerGroupLabel("默认群组")).toBe("默认群组");
  });
});
