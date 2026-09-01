import { describe, expect, it } from "vitest";

import type { ProviderConnectionView } from "./client-api";
import {
  directorBrainConnections,
  directorConfiguredModelInventory,
  directorModelSupportsText,
  ensureDirectorModel,
  findProviderGroupConnection,
  mergeDirectorModelInventory,
  preferredDirectorModelId,
} from "./director-provider-options";

function connection(
  id: string,
  config: Record<string, unknown>,
  overrides: Partial<ProviderConnectionView> = {},
): ProviderConnectionView {
  return {
    id,
    name: id,
    provider: "rest",
    config,
    apiKeySet: true,
    apiKeyUsable: true,
    apiKey: "",
    ...overrides,
  };
}

describe("director provider options", () => {
  it("keeps the saved model visible when it is absent from a stale inventory", () => {
    const inventory = directorConfiguredModelInventory(
      connection("saved-model-group", { defaultModel: "default-model" }),
    );
    const next = ensureDirectorModel(inventory, "saved-model");

    expect(next.models.some((model) => model.id === "saved-model")).toBe(true);
    expect(ensureDirectorModel(next, "saved-model")).toBe(next);
  });

  it("automatically includes every configured supplier group, not only agent connections", () => {
    const canvas = connection("canvas-group", {
      usage: "canvas",
      supplierKey: "supplier-a",
      modelGroup: "LLM-GPT",
    });
    const agent = connection("agent-group", {
      usage: "agent",
      supplierKey: "supplier-a",
      modelGroup: "LLM-Claude",
    });
    const noKey = connection(
      "no-key",
      { usage: "agent" },
      { apiKeySet: false, apiKeyUsable: false },
    );
    const tavily = connection("tavily", { usage: "agent" });

    expect(directorBrainConnections([canvas, agent, noKey, tavily])).toEqual([
      agent,
      canvas,
    ]);
  });

  it("loads every chat model from the selected marketplace group", () => {
    const selected = connection("cangyuan-group", {
      usage: "canvas",
      supplierKey: "cangyuan",
      modelGroup: "LLM-GPT-plus",
      defaultModel: "gpt-5.4",
    });
    const inventory = directorConfiguredModelInventory(selected, {
      cangyuan: [
        {
          id: "LLM-GPT-plus",
          description: "group",
          ratio: 1,
          canvasSupported: false,
          models: [
            {
              id: "gpt-5.4",
              name: "GPT 5.4",
              capability: "chat",
              priceLabel: "-",
              billingLabel: "-",
              tags: [],
              endpointTypes: [],
            },
            {
              id: "gpt-5.4-mini",
              name: "GPT 5.4 Mini",
              capability: "chat",
              priceLabel: "-",
              billingLabel: "-",
              tags: [],
              endpointTypes: [],
            },
            {
              id: "gpt-image-2",
              name: "GPT Image 2",
              capability: "image",
              priceLabel: "-",
              billingLabel: "-",
              tags: [],
              endpointTypes: [],
            },
          ],
        },
      ],
    });

    expect(inventory.scoped).toBe(true);
    expect(inventory.models.map((model) => model.id)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
    expect(inventory.models.every(directorModelSupportsText)).toBe(true);
  });

  it("merges live names while keeping a scoped group from leaking other models", () => {
    const configured = directorConfiguredModelInventory(
      connection("group", {
        allowedModels: ["gpt-a", "gpt-b"],
        defaultModel: "gpt-a",
      }),
    );
    const merged = mergeDirectorModelInventory(configured, [
      { id: "gpt-a", name: "GPT A", operations: [], outputKinds: ["text"] },
      { id: "outside", name: "Outside", operations: [], outputKinds: ["text"] },
    ]);

    expect(merged.map((model) => model.id)).toEqual(["gpt-a", "gpt-b"]);
    expect(merged[0]?.name).toBe("GPT A");
  });

  it("marks media-only models unavailable and chooses the first text model", () => {
    const models = [
      {
        id: "image-model",
        name: "Image",
        operations: ["image.generate" as const],
        outputKinds: ["image" as const],
      },
      {
        id: "chat-model",
        name: "Chat",
        operations: [],
        outputKinds: ["text" as const],
      },
    ];
    expect(directorModelSupportsText(models[0]!)).toBe(false);
    expect(preferredDirectorModelId(models, "image-model")).toBe("chat-model");
  });

  it("always resolves a keyed group even when its saved usage label is stale", () => {
    const staleCanvas = connection("stale", {
      usage: "canvas",
      supplierKey: "cangyuan",
      modelGroup: "LLM-GPT-plus",
    });
    const unkeyedAgent = connection(
      "agent",
      {
        usage: "agent",
        supplierKey: "cangyuan",
        modelGroup: "LLM-GPT-plus",
      },
      { apiKeySet: false, apiKeyUsable: false },
    );

    expect(
      findProviderGroupConnection(
        [unkeyedAgent, staleCanvas],
        "cangyuan",
        "LLM-GPT-plus",
        "agent",
      )?.id,
    ).toBe("stale");
  });
});
