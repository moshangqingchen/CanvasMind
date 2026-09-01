import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import {
  isWeAiConnectionConfig,
  providerConnectionGroup,
  providerConnectionSupplierKey,
  providerConnectionSupplierWebsite,
  providerConnectionUsage,
  providerGroupLabel,
  providerSupplierLabel,
  providerSupplierWebsite,
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
  it("does not classify Mikoto Gemini connections as We-AI", () => {
    expect(
      isWeAiConnectionConfig({
        provider: "weai",
        config: { supplierKey: "mikoto", preset: "mikoto-pro" },
      }),
    ).toBe(false);
    expect(
      isWeAiConnectionConfig({
        provider: "weai",
        config: { supplierKey: "weai", preset: "weai-images" },
      }),
    ).toBe(true);
  });

  it("uses the configured Cangyuan preset as the visible supplier", () => {
    const item = connection("rest", {
      preset: "cangyuan-gpt-image-2",
      modelGroup: "IMAGE",
    });

    expect(providerConnectionSupplierKey(item)).toBe("cangyuan");
    expect(providerSupplierLabel("cangyuan")).toBe("沧元算力");
    expect(providerSupplierWebsite("cangyuan")).toBe(
      "https://ai.cangyuansuanli.cn/",
    );
    expect(providerConnectionSupplierWebsite(item)).toBe(
      "https://ai.cangyuansuanli.cn/",
    );
    expect(providerConnectionGroup(item)).toBe("IMAGE");
    expect(providerConnectionUsage(item)).toBe("canvas");
  });

  it("keeps MikotoPro in its own supplier bucket", () => {
    const item = connection("rest", {
      preset: "mikoto-pro",
      supplierKey: "mikoto",
      modelGroup: "图片与视频",
    });

    expect(providerConnectionSupplierKey(item)).toBe("mikoto");
    expect(providerSupplierLabel("mikoto")).toBe("MikotoPro");
    expect(providerConnectionGroup(item)).toBe("图片与视频");
  });

  it("keeps Miaowu in its own video supplier bucket", () => {
    const item = connection("rest", {
      preset: "miaowu-openai-videos",
      modelGroup: "OpenAI Videos",
    });

    expect(providerConnectionSupplierKey(item)).toBe("miaowu");
    expect(providerSupplierLabel("miaowu")).toBe("喵呜 API");
    expect(providerConnectionGroup(item)).toBe("OpenAI Videos");
  });

  it("keeps FriModel in its own live-image supplier bucket", () => {
    const item = connection("openai", {
      preset: "frimodel-openai-images",
      modelGroup: "实时图片模型",
    });

    expect(providerConnectionSupplierKey(item)).toBe("frimodel");
    expect(providerSupplierLabel("frimodel")).toBe("FriModel");
    expect(providerConnectionSupplierWebsite(item)).toBe(
      "https://platform.frimodel.com/",
    );
    expect(providerConnectionGroup(item)).toBe("实时图片模型");
  });

  it("keeps 辰途 API in its own live-image supplier bucket", () => {
    const item = connection("openai", {
      preset: "chentu-openai-images",
      modelGroup: "实时图片模型",
    });

    expect(providerConnectionSupplierKey(item)).toBe("chentu");
    expect(providerSupplierLabel("chentu")).toBe("辰途 API");
    expect(providerConnectionSupplierWebsite(item)).toBe(
      "https://tu.988236.xyz/",
    );
    expect(providerConnectionGroup(item)).toBe("实时图片模型");
  });

  it("keeps generic providers separate and supplies a default group", () => {
    const item = connection("rest", {});

    expect(providerConnectionSupplierKey(item)).toBe("rest");
    expect(providerSupplierLabel("rest")).toBe("通用 REST");
    expect(providerConnectionGroup(item)).toBe("默认群组");
  });

  it("labels We-AI as a first-class supplier", () => {
    const item = connection("weai", {});

    expect(providerConnectionSupplierKey(item)).toBe("weai");
    expect(providerSupplierLabel("weai")).toBe("We-AI");
  });

  it("keeps Cyber Afei API in its own supplier bucket", () => {
    const item = connection("rest", {
      preset: "cyberafei-api",
      supplierKey: "cyberafei",
      modelGroup: "image-2稳定生图",
    });

    expect(providerConnectionSupplierKey(item)).toBe("cyberafei");
    expect(providerSupplierLabel("cyberafei")).toBe("赛博阿飞 API");
    expect(providerConnectionGroup(item)).toBe("image-2稳定生图");

    expect(
      providerConnectionSupplierKey(
        connection("rest", { preset: "cyberafei-api" }),
      ),
    ).toBe("cyberafei");
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
    expect(providerConnectionSupplierWebsite(item)).toBeUndefined();
  });

  it("uses a configured HTTPS website for custom suppliers", () => {
    const item = connection("rest", {
      supplierKey: "自定义供应商",
      supplierWebsiteUrl: "https://provider.example/account",
    });

    expect(providerConnectionSupplierWebsite(item)).toBe(
      "https://provider.example/account",
    );
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

  it("keeps disabled legacy connections out of canvas and director usage", () => {
    const item = connection("rest", {
      preset: "cyberafei-api",
      modelGroup: "gpt5.6-破甲版",
      usage: "disabled",
    });

    expect(providerConnectionUsage(item)).toBe("disabled");
  });

  it("shows live group ratios without changing the stored group value", () => {
    expect(providerGroupLabel("LLM-GPT-plus", 0.075)).toBe(
      "LLM-GPT-plus（x0.075）",
    );
    expect(providerGroupLabel("默认群组")).toBe("默认群组");
  });
});
