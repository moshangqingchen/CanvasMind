import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import { canvasPickerConnections } from "./canvas-provider-picker";

function connection(id: string, usage: "canvas" | "agent", config: Record<string, unknown> = {}): ProviderConnectionView {
  return {
    id, name: `词元 · default · ${usage === "canvas" ? "图片" : "文本"}`,
    provider: usage === "canvas" ? "openai" : "rest", apiKeySet: true, apiKeyUsable: true, apiKey: "",
    config: { supplierId: "supplier", supplierSourceId: "source", accountKeyId: "686",
      accountKeyGroup: "default", modelGroup: "default", baseUrl: "https://api.tk1688.com/v1", usage,
      protocol: usage === "canvas" ? "openai-images" : "openai-chat", ...config },
  };
}

const image = connection("image", "canvas"), text = connection("text", "agent");
const ready = (item: ProviderConnectionView) => item.apiKeyUsable === true;

describe("canvas connection purpose copies", () => {
  it("shows one same-key词元 choice and prefers the canvas purpose for a new selection", () => {
    expect(canvasPickerConnections([text, image], undefined, ready)).toEqual([image]);
    expect(canvasPickerConnections([image, text], "image", ready)).toEqual([image]);
  });

  it("keeps the saved legacy agent ID and leaves all connection records unchanged", () => {
    const before = structuredClone([image, text]);
    expect(canvasPickerConnections([image, text], "text", ready)).toEqual([text]);
    expect([image, text]).toEqual(before);
    expect(canvasPickerConnections([text], "text", ready)).toEqual([text]);
  });

  it("keeps independent accounts, keys, groups, endpoints and unproven legacy identities", () => {
    for (const patch of [
      { supplierId: "other" }, { supplierSourceId: "other" }, { accountKeyId: "other" },
      { accountKeyId: undefined }, { modelGroup: "vip" }, { baseUrl: "https://ai.tk1688.com/v1" },
    ]) {
      const other = connection("other", "agent", patch);
      expect(canvasPickerConnections([image, other], "image", ready)).toEqual([image, other]);
    }
  });

  it("does not collapse other suppliers or intentional configurations of the same purpose", () => {
    const otherImage = connection("other-image", "canvas");
    expect(canvasPickerConnections([image, otherImage, text], "image", ready)).toEqual([image, otherImage, text]);
    expect(canvasPickerConnections([image, otherImage], "image", ready)).toEqual([image, otherImage]);
    const items = [connection("a", "canvas", { baseUrl: "https://other.example/v1" }),
      connection("b", "agent", { baseUrl: "https://other.example/v1" })];
    expect(canvasPickerConnections(items, "a", ready)).toEqual(items);
  });

  it("preserves hand-authored connectors, model mappings and different transports on the same key", () => {
    for (const patch of [
      { connector: { output: { kind: "image" } } }, { manualModels: [{ id: "custom" }] },
      { modelInterfaces: { custom: { path: "/custom" } } }, { protocol: "responses" },
    ]) {
      const custom = connection("custom", "agent", patch);
      expect(canvasPickerConnections([image, custom], "image", ready)).toEqual([image, custom]);
    }
    const customImage = { ...image, provider: "rest" };
    expect(canvasPickerConnections([customImage, text], "image", ready)).toEqual([customImage, text]);
  });

  it("retains an unavailable historical choice beside its usable recovery connection", () => {
    const unavailableImage = { ...image, apiKeyUsable: false };
    expect(canvasPickerConnections([unavailableImage, text], "image", ready)).toEqual([unavailableImage, text]);
    expect(canvasPickerConnections([unavailableImage, text], undefined, ready)).toEqual([text]);
    expect(canvasPickerConnections([image, { ...text, apiKeyUsable: false }], "image", ready)).toEqual([image]);
  });
});
