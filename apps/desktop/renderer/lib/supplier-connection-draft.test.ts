import { describe, expect, it } from "vitest";
import { supplierConnectionDraft } from "./supplier-connection-draft";
import {
  CANGYUAN_IMAGE_GROUP,
  CANGYUAN_IMAGE_PRESET_ID,
} from "./provider-presets";
import { MIKOTO_GEMINI_GROUP, MIKOTO_PRESET_ID } from "./mikoto-presets";

describe("new supplier group adapters", () => {
  it("retains official group identity for custom, agent, and preset connections", () => {
    for (const [supplierKey, groupId, usage] of [
      ["custom-test", "Named group", "canvas"],
      ["cangyuan", CANGYUAN_IMAGE_GROUP, "agent"],
      ["cangyuan", CANGYUAN_IMAGE_GROUP, "canvas"],
    ] as const) {
      const result = supplierConnectionDraft(supplierKey,
        { id: groupId, label: groupId, supplierGroupId: "115", source: "catalog", models: [] }, usage, "https://relay.example.com");
      expect(result.config.accountKeyGroupId).toBe("115");
      expect(result.config.modelGroup).toBe(groupId);
    }
  });
  it("retains the Cangyuan asynchronous REST adapter for known public groups", () => {
    const result = supplierConnectionDraft(
      "cangyuan",
      {
        id: CANGYUAN_IMAGE_GROUP,
        label: "Image",
        source: "catalog",
        models: [],
      },
      "canvas",
      "https://ai.cangyuansuanli.cn",
    );
    expect(result.provider).toBe("rest");
    expect(result.config.preset).toBe(CANGYUAN_IMAGE_PRESET_ID);
    expect(result.config.connector).toBeDefined();
  });
  it("retains the existing Mikoto Gemini protocol", () => {
    const result = supplierConnectionDraft(
      "mikoto",
      {
        id: MIKOTO_GEMINI_GROUP,
        label: "Gemini",
        source: "catalog",
        models: [],
      },
      "canvas",
      "https://api.mikoto.vip",
    );
    expect(result.provider).toBe("weai");
    expect(result.config.preset).toBe(MIKOTO_PRESET_ID);
    expect(result.config.protocol).toBe("gemini-generate-content");
  });
  it("does not attach canvas adapters or presets to the agent usage", () => {
    const result = supplierConnectionDraft(
      "cangyuan",
      {
        id: CANGYUAN_IMAGE_GROUP,
        label: "Image",
        source: "catalog",
        models: [],
      },
      "agent",
      "https://ai.cangyuansuanli.cn",
    );
    expect(result.provider).toBe("rest");
    expect(result.config.usage).toBe("agent");
    expect(result.config.preset).toBeUndefined();
    expect(result.config.connector).toBeUndefined();
  });
  it("creates unknown manual groups without guessing model IDs", () => {
    const result = supplierConnectionDraft(
      "custom-test",
      { id: "private-vip", label: "Private", source: "manual", models: [] },
      "canvas",
      "https://relay.example.com/gateway/v1",
    );
    expect(result.provider).toBe("openai");
    expect(result.config.baseUrl).toBe("https://relay.example.com/gateway/v1");
    expect(result.config.defaultModel).toBeUndefined();
    expect(result.config.customGroup).toBe(true);
  });
});
