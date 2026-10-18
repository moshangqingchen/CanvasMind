import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { parseLangframeCatalog, type SupplierAccountKey, type SupplierAccountKeys } from "@super-canvas/providers";
import { planSupplierAccountImport } from "./supplier-account-import";
import { langframeModelsInScope, langframeScopeGroupId } from "./langframe-account-import";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/langframe-catalog-20261018.json", import.meta.url), "utf8"));
const keyId = "707b2ab1-03f2-46d1-8217-b0b2693d2a71";
const checkedAt = "2026-10-18T09:00:00.000Z";
const encrypt = (secret: string) => `offline-encrypted:${secret}`;
const matchesKey = (connection: ProviderConnectionRecord, secret: string) => connection.encryptedSecret === encrypt(secret);
const options = { verifyCapabilities: false, matchesKey };
function supplier(): SupplierRecord {
  return { id: "wolf", supplierKey: "custom-wolf", name: "狼帧", siteUrl: "https://vipprompt.cn", apiUrl: "https://vipprompt.cn",
    kind: "auto", catalog: { groups: parseLangframeCatalog(fixture.payload, { checkedAt: fixture.checkedAt }).groups }, scanStatus: "live",
    createdAt: checkedAt, updatedAt: checkedAt,
    state: { version: 1, revision: 1, visibility: "visible", sourceId: "wolf-source", fingerprint: "wolf-fingerprint", history: [] } };
}
function key(patch: Partial<SupplierAccountKey> = {}): SupplierAccountKey {
  return { id: keyId, group: `账户 Key ${keyId}`, apiKey: "offline-langframe-account-key", name: "offline saved Key",
    accountGroups: [], modelIds: [], routing: "ordered-fallback", ...patch };
}
function inventory(keys: SupplierAccountKey[] = [key()]): SupplierAccountKeys {
  return { keys, complete: true, skipped: 0, checkedAt };
}
function connectionFor(plan: { connections: ProviderConnectionRecord[] }, usage: string, accountKeyId = keyId) {
  return plan.connections.find(connection => connection.config.usage === usage && connection.config.accountKeyId === accountKeyId)!;
}
function withScopes(current: SupplierRecord, plan: { catalog: SupplierRecord["catalog"] }) {
  return { ...current, catalog: plan.catalog };
}

describe("Langframe account import through the supplier pipeline", () => {
  it("imports one real UUID Key as two local scopes while preserving the 39 independent public categories", () => {
    const current = supplier(), before = JSON.stringify(current);
    const plan = planSupplierAccountImport(current, [], inventory(), encrypt, [], options);
    expect(plan.connections).toHaveLength(2);
    expect(plan.summary).toMatchObject({ imported: 2, preserved: 0 });
    expect(plan.catalog.groups.filter(group => !group.id.startsWith("langframe-key:"))).toEqual(current.catalog.groups);
    const media = connectionFor(plan, "canvas"), agent = connectionFor(plan, "agent");
    for (const [connection, usage] of [[media, "canvas"], [agent, "agent"]] as const) {
      expect(connection).toMatchObject({ provider: "langframe", encryptedSecret: encrypt(key().apiKey), config: {
        accountKeyId: keyId, modelGroup: langframeScopeGroupId(keyId, usage), accountKeyGroup: langframeScopeGroupId(keyId, usage),
        langframeAccountGroups: [], langframeModelIds: [], langframeRouting: "ordered-fallback", langframeKeyScope: true,
      } });
      expect(connection.config.accountKeyGroupId).toBeUndefined();
      expect(connection.config.supplierVerificationRequestId).toBeUndefined();
      const scope = plan.catalog.groups.find(group => group.id === connection.config.modelGroup)!;
      expect(scope.details?.source).toBe("key-groups");
      expect(scope.details?.description).toContain("不是独立上游路由分组");
    }
    expect(langframeModelsInScope(withScopes(current, plan), media.config)).toHaveLength(39);
    expect(langframeModelsInScope(withScopes(current, plan), agent.config).map(model => model.id)).toEqual(["gpt-5.6-sol"]);
    expect(JSON.stringify(current)).toBe(before);
    expect(JSON.stringify(plan.summary)).not.toContain(key().apiKey);
  });

  it("keeps different UUID Keys separate and makes a second scan idempotent", () => {
    const current = supplier();
    const keys = inventory([key(), key({ id: "second-uuid-key", apiKey: "offline-other-account-key", name: "other" })]);
    const first = planSupplierAccountImport(current, [], keys, encrypt, [], options);
    expect(first.connections).toHaveLength(4);
    expect(new Set(first.connections.map(connection => connection.id)).size).toBe(4);
    expect(first.connections.filter(connection => connection.config.accountKeyId === "second-uuid-key")).toHaveLength(2);
    const repeat = planSupplierAccountImport(withScopes(current, first), first.connections, keys, encrypt, first.connections, options);
    expect(repeat.connections).toEqual(first.connections);
    expect(repeat.summary).toMatchObject({ imported: 0, preserved: 4 });
    expect(repeat.catalog.groups).toHaveLength(43);
  });

  it("intersects allowed public group names with public model names without substituting inner IDs", () => {
    const current = supplier(), groups = ["下游分组2", "gpt-image-2.5-flare-1K-2k-4k"];
    const modelIds = ["gpt-5.6-sol", "image-2.5-flare-1K-2k-4kMAX品质", "nano-banana-2", "gpt-image-2"];
    const plan = planSupplierAccountImport(current, [], inventory([key({ accountGroups: groups, modelIds })]), encrypt, [], options);
    expect(plan.connections).toHaveLength(2);
    const scoped = withScopes(current, plan);
    expect(langframeModelsInScope(scoped, connectionFor(plan, "canvas").config).map(model => model.id)).toEqual(["image-2.5-flare-1K-2k-4kMAX品质"]);
    expect(langframeModelsInScope(scoped, connectionFor(plan, "agent").config).map(model => model.id)).toEqual(["gpt-5.6-sol"]);
    for (const connection of plan.connections) {
      expect(connection.config.langframeAccountGroups).toEqual(groups);
      expect(connection.config.langframeModelIds).toEqual(modelIds);
    }
    const disjoint = planSupplierAccountImport(current, [], inventory([key({ accountGroups: ["下游分组2"], modelIds: ["nano-banana-2"] })]), encrypt, [], options);
    expect(disjoint.connections).toEqual([]);
  });

  it("retains chat fallback order and each candidate tariff without borrowing one group's price", () => {
    const current = supplier();
    const plan = planSupplierAccountImport(current, [], inventory([key({ accountGroups: ["下游分组2", "下游分组1"], modelIds: ["gpt-5.6-sol"] })]), encrypt, [], options);
    expect(plan.connections).toHaveLength(1);
    const model = langframeModelsInScope(withScopes(current, plan), connectionFor(plan, "agent").config)[0]!;
    expect(model.pricing).toBeUndefined();
    expect(model.metadata?.langframePricing).toBeUndefined();
    expect(model.metadata?.langframePricingRequiresGroup).toBe(true);
    expect(model.metadata?.langframeGroupCatalog).toMatchObject([{ groupName: "下游分组2" }, { groupName: "下游分组1" }]);
    const stored = plan.catalog.groups.find(group => group.id.startsWith("langframe-key:"))!.models[0]!;
    expect(stored.metadata?.langframePricing).toBeUndefined();
    expect(stored.priceLabel).toContain("分组独立计价");
  });

  it("refreshes a proven Key's actual scope while preserving its connection identity and user selections", () => {
    const current = supplier(), first = planSupplierAccountImport(current, [], inventory(), encrypt, [], options);
    const media = connectionFor(first, "canvas"), agent = connectionFor(first, "agent");
    const saved: ProviderConnectionRecord = { ...media, name: "My named canvas connection", config: { ...media.config,
      defaultModel: "image-2.5-sunburst-1K-2k-4k-MAX品质", quality: "max", resolution: "4K", size: "3840x2160",
      manualModels: [{ id: "my-manual", capability: "image" }], promptPrefix: "keep my prefix" } };
    const before = [saved, agent];
    const restricted = inventory([key({ accountGroups: ["nano-banana-2", "下游分组1"], modelIds: ["nano-banana-2", "gpt-5.6-sol"] })]);
    const plan = planSupplierAccountImport(withScopes(current, first), before, restricted, encrypt, before, options);
    expect(plan.connections).toHaveLength(2);
    expect(connectionFor(plan, "canvas")).toMatchObject({ id: saved.id, name: saved.name, encryptedSecret: saved.encryptedSecret,
      config: { defaultModel: saved.config.defaultModel, quality: "max", resolution: "4K", size: "3840x2160",
        manualModels: saved.config.manualModels, promptPrefix: "keep my prefix", langframeAccountGroups: ["nano-banana-2", "下游分组1"] } });
    expect(langframeModelsInScope(withScopes(current, plan), connectionFor(plan, "canvas").config).map(model => model.id)).toEqual(["nano-banana-2"]);
  });

  it("updates both existing scopes when a Key loses every media model without clamping the user's old selection", () => {
    const current = supplier(), first = planSupplierAccountImport(current, [], inventory(), encrypt, [], options);
    const media = connectionFor(first, "canvas");
    const tightened = inventory([key({ accountGroups: ["下游分组1"], modelIds: ["gpt-5.6-sol"] })]);
    const plan = planSupplierAccountImport(withScopes(current, first), first.connections, tightened, encrypt, first.connections, options);
    const updated = plan.connections.find(connection => connection.id === media.id)!;
    expect(updated.config.defaultModel).toBe(media.config.defaultModel);
    expect(updated.config.langframeAccountGroups).toEqual(["下游分组1"]);
    expect(updated.config.langframeModelIds).toEqual(["gpt-5.6-sol"]);
    expect(langframeModelsInScope(withScopes(current, plan), updated.config)).toEqual([]);
    expect(plan.catalog.groups.find(group => group.id === media.config.modelGroup)?.models).toEqual([]);
  });

  it("does not widen a missing or malformed permission declaration into all-model access", () => {
    const current = supplier();
    for (const config of [
      { usage: "canvas" }, { usage: "canvas", langframeAccountGroups: [], langframeModelIds: undefined },
      { usage: "canvas", langframeAccountGroups: "all", langframeModelIds: [] },
      { usage: "canvas", langframeAccountGroups: [null], langframeModelIds: [] },
      { usage: "canvas", langframeAccountGroups: [], langframeModelIds: [""] },
    ]) expect(langframeModelsInScope(current, config)).toEqual([]);
  });

  it.each([false, true])("preserves disabled connections and a user-cleared Key with preserveOnly=%s", preserveOnly => {
    const current = supplier(), first = planSupplierAccountImport(current, [], inventory(), encrypt, [], options);
    const media = connectionFor(first, "canvas"), agent = connectionFor(first, "agent");
    const disabled = { ...media, config: { ...media.config, usage: "disabled" } };
    const cleared = { ...agent, encryptedSecret: null };
    const saved = [disabled, cleared];
    const plan = planSupplierAccountImport(withScopes(current, first), saved, inventory(), () => { throw Error("Unexpected Key import"); }, saved,
      { ...options, preserveOnly });
    expect(plan.connections).toEqual(saved);
    expect(plan.summary.imported).toBe(0);
  });

  it("preserves edits and Key clearing made while a scan is in flight", () => {
    const current = supplier(), first = planSupplierAccountImport(current, [], inventory(), encrypt, [], options);
    const media = connectionFor(first, "canvas"), agent = connectionFor(first, "agent");
    const edited = { ...media, name: "User edited this during the scan", config: { ...media.config, defaultModel: "nano-banana-2.1" } };
    const cleared = { ...agent, encryptedSecret: null };
    const currentConnections = [edited, cleared];
    const changedPermissions = inventory([key({ accountGroups: ["nano-banana-2", "下游分组1"], modelIds: ["nano-banana-2", "gpt-5.6-sol"] })]);
    const plan = planSupplierAccountImport(withScopes(current, first), currentConnections, changedPermissions, encrypt, first.connections, options);
    expect(plan.connections).toEqual(currentConnections);
    expect(plan.summary.imported).toBe(0);
    for (const original of first.connections) {
      const actual = plan.catalog.groups.find(group => group.id === original.config.modelGroup)!;
      const previous = first.catalog.groups.find(group => group.id === original.config.modelGroup)!;
      expect(actual.models.map(model => model.id)).toEqual(previous.models.map(model => model.id));
      expect(actual.details?.description).toBe(previous.details?.description);
    }
  });

  it("does not recreate a connection deleted while its Key scan was in flight", () => {
    const current = supplier(), first = planSupplierAccountImport(current, [], inventory(), encrypt, [], options);
    const remaining = [connectionFor(first, "agent")];
    const plan = planSupplierAccountImport(withScopes(current, first), remaining, inventory(), encrypt, first.connections, options);
    expect(plan.connections).toEqual(remaining);
    expect(plan.summary.imported).toBe(0);
  });

  it("does not publish another Key's refreshed model scope over a manually replaced credential", () => {
    const current = supplier(), first = planSupplierAccountImport(current, [], inventory(), encrypt, [], options);
    const media = connectionFor(first, "canvas"), manual = { ...media, encryptedSecret: encrypt("manual-different-key") };
    const saved = [manual, connectionFor(first, "agent")];
    const restricted = inventory([key({ accountGroups: ["nano-banana-2"], modelIds: ["nano-banana-2"] })]);
    const plan = planSupplierAccountImport(withScopes(current, first), saved, restricted, encrypt, saved, options);
    expect(plan.connections.find(connection => connection.id === manual.id)).toEqual(manual);
    const actual = plan.catalog.groups.find(group => group.id === manual.config.modelGroup)!;
    const prior = first.catalog.groups.find(group => group.id === manual.config.modelGroup)!;
    expect(actual.models.map(model => model.id)).toEqual(prior.models.map(model => model.id));
    expect(actual.details?.description).toBe(prior.details?.description);
  });

  it("does not use a stale public category or its previous synthetic scope as fresh model evidence", () => {
    const current = supplier(), first = planSupplierAccountImport(current, [], inventory([key({ accountGroups: ["nano-banana-2"] })]), encrypt, [], options);
    const stored = withScopes(current, first), media = connectionFor(first, "canvas");
    const stale: SupplierRecord = { ...stored, catalog: { groups: stored.catalog.groups.map(group => group.id === "nano-banana-2"
      ? { ...group, details: { ...group.details, source: "model-plaza", stale: true } } : group) } };
    expect(langframeModelsInScope(stale, media.config)).toEqual([]);
    const incomplete = { ...inventory(), keys: [], complete: false, error: "Account read unavailable" };
    const plan = planSupplierAccountImport(stored, first.connections, incomplete, encrypt, first.connections, options);
    expect(plan.connections).toEqual(first.connections);
    expect(plan.summary.status).toBe("failed");
  });
});
