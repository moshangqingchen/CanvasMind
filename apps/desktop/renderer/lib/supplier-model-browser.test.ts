import { describe, expect, it } from "vitest";
import { descriptorKinds, matchesModelText, supplierGroupMatchesQuery } from "./supplier-model-browser";
import type { ProviderConnectionView } from "./client-api";

describe("supplier model search", () => {
  const group = { id: "vip", label: "创作组", models: [] };
  const connection = (modelGroup: string, config: Record<string, unknown>): ProviderConnectionView => ({
    id: modelGroup, name: modelGroup, provider: "openai", apiKey: "", apiKeySet: true, config: { modelGroup, ...config },
  });
  it("finds Key-only names and IDs, manual and removed models without leaking other groups", () => {
    const connections = [connection("vip", { modelCatalogModels: [{ id: "gpt-image-2", name: "新版绘图" }], manualModels: [{ id: "custom-4k" }], modelRemovedModels: [{ id: "old-image" }] }), connection("other", { scannedModelIds: ["private-other"] })];
    for (const query of ["GPT-image", "新版", "custom-4k", "old-image", "创作组"]) expect(supplierGroupMatchesQuery(group, connections, query)).toBe(true);
    expect(supplierGroupMatchesQuery(group, connections, "private-other")).toBe(false);
    expect(supplierGroupMatchesQuery(group, connections, "missing")).toBe(false);
  });
  it("matches legacy ID snapshots and account-bound group aliases", () => {
    expect(supplierGroupMatchesQuery(group, [connection("legacy", { accountKeyGroup: "vip", scannedModelIds: ["exact-model"] })], "exact")).toBe(true);
  });
  it("searches all query terms and preserves multi-capability descriptors", () => {
    expect(matchesModelText({ id: "image-v2", name: "模型创作" }, "IMAGE 创作")).toBe(true);
    expect(matchesModelText({ id: "image-v2" }, "image missing")).toBe(false);
    expect(descriptorKinds({ operations: ["image.generate", "image.edit", "video.generate"] })).toEqual(["image", "video"]);
  });
});
