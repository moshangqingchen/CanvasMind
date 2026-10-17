import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { CATALOG_MEMBERSHIP_DAY_MS, catalogInventoryModelsValid, catalogMembershipSuspiciousDrop,
  reduceCatalogInventory, type CatalogInventoryReductionInput, type CatalogInventoryState } from "./catalog-inventory-policy";

const at = (day: number) => new Date(Date.UTC(2001, 0, 1) + day * CATALOG_MEMBERSHIP_DAY_MS).toISOString();
const models = (count: number, prefix = "fixture-"): ModelDescriptor[] => Array.from({ length: count }, (_, i) =>
  ({ id: `${prefix}${i}`, name: `${prefix}${i}`, operations: ["image.generate"] }));
function observation(sourceKey: string, rows: ModelDescriptor[], day = 0, overrides: Partial<CatalogReadObservation["receipt"]> = {}): CatalogReadObservation {
  return { receipt: { spec: { sourceKey, entryId: sourceKey, sourceUrl: `https://fixture.invalid/${sourceKey}`,
    parserVersion: "fixture-v1", authScope: { kind: "connection-key", principalRef: "connection-1", credentialEpoch: "credential-1" },
    applyScope: { supplierId: "supplier-1", supplierSourceId: "source-1", connectionIds: ["connection-1"], groupIdentity: "site-id:7" },
    role: "key-membership", requiredForMembership: true },
    context: { runId: `run-${day}`, observationCycleId: `cycle-${day}`, identityEpoch: "epoch-1", dispatchSeq: day * 100 + 1 },
    status: "succeeded", complete: true, freshness: "live", checkedAt: at(day),
    coverage: { domain: "key-list", modelIds: rows.map(model => model.id), exhaustive: true }, ...overrides }, facts: { models: rows } };
}
function input(rows: CatalogReadObservation[], day = 0, extra: Partial<CatalogInventoryReductionInput> = {}): CatalogInventoryReductionInput {
  return { connectionId: "connection-1", identityEpoch: "epoch-1", observationCycleId: `cycle-${day}`,
    observedAt: at(day), mode: "daily", requiredSourceKeys: ["key"], observations: rows, ...extra };
}
function reduce(state: CatalogInventoryState | undefined, rows: ModelDescriptor[], day: number,
  extra: Partial<CatalogInventoryReductionInput> = {}) {
  return reduceCatalogInventory(state, input([observation("key", rows, day)], day, extra));
}

describe("catalog membership validation and shrink threshold", () => {
  it("validates full opaque IDs and rejects duplicate, malformed and non-JSON rows", () => {
    expect(catalogInventoryModelsValid([{ id: "Full/Model-4K@group", name: "完整型号", operations: [] }])).toBe(true);
    expect(catalogInventoryModelsValid([...models(1), ...models(1)])).toBe(false);
    expect(catalogInventoryModelsValid([{ id: "m", name: "m", operations: ["chat"] } as unknown as ModelDescriptor])).toBe(false);
    expect(catalogInventoryModelsValid([{ ...models(1)[0]!, metadata: { bad: NaN } }])).toBe(false);
    expect(catalogInventoryModelsValid([{ ...models(1)[0]!, metadata: { bad: () => 0 } }])).toBe(false);
  });
  it("uses >=20 baseline, >=10 missing and >=30%, with any nonempty-to-empty protected", () => {
    expect(catalogMembershipSuspiciousDrop(models(19).map(m => m.id), models(9).map(m => m.id))).toBe(false);
    expect(catalogMembershipSuspiciousDrop(models(20).map(m => m.id), models(10).map(m => m.id))).toBe(true);
    expect(catalogMembershipSuspiciousDrop(models(40).map(m => m.id), models(30).map(m => m.id))).toBe(false);
    expect(catalogMembershipSuspiciousDrop(models(40).map(m => m.id), models(28).map(m => m.id))).toBe(true);
    expect(catalogMembershipSuspiciousDrop(["m"], [])).toBe(true);
  });
  it("cannot offset missing baseline members by adding unrelated new IDs", () => {
    expect(catalogMembershipSuspiciousDrop(models(100).map(m => m.id),
      [...models(40), ...models(100, "new-")].map(m => m.id))).toBe(true);
  });
});

describe("catalog accepted source contributions and connection manifest", () => {
  it("does not invent source history or trusted baselines from legacy descriptors", () => {
    const result = reduceCatalogInventory(undefined, input([], 0, { initialModels: models(20) }));
    expect(result.visibleModels).toEqual(models(20)); expect(result.state.sources).toEqual({});
    expect(result.manifestComplete).toBe(false); expect(result.historicalModels).toEqual([]);
  });
  it("accepts a fresh complete source and survives JSON persistence", () => {
    const result = reduce(undefined, models(3), 0);
    expect(result.visibleModels).toEqual(models(3)); expect(result.manifestComplete).toBe(true);
    expect(result.state.sources.key?.baseline?.modelIds).toEqual(models(3).map(m => m.id));
    expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
  });
  it("keeps independent source union when one source withdraws a shared member", () => {
    const previous = reduceCatalogInventory(undefined, input([observation("key", models(3)), observation("native", models(2))], 0,
      { requiredSourceKeys: ["key", "native"] })).state;
    const result = reduceCatalogInventory(previous, input([observation("key", models(1), 1), observation("native", models(2), 1)], 1,
      { requiredSourceKeys: ["key", "native"] }));
    expect(result.visibleModels.map(m => m.id)).toEqual(["fixture-0", "fixture-1"]);
    expect(result.removedIds).toEqual(["fixture-2"]);
  });
  it("holds connection removals if required B fails, even when B never had the missing A member", () => {
    const previous = reduceCatalogInventory(undefined, input([observation("key", models(3)), observation("native", models(1, "native-"))], 0,
      { requiredSourceKeys: ["key", "native"] })).state;
    const result = reduceCatalogInventory(previous, input([observation("key", models(1), 1),
      observation("native", [], 1, { status: "failed", complete: false, reason: "network" })], 1,
    { requiredSourceKeys: ["key", "native"] }));
    expect(result.state.sources.key?.acceptedModels).toEqual(models(1));
    expect(result.visibleModels).toEqual([...models(3), ...models(1, "native-")]);
    expect(result.removedIds).toEqual([]); expect(result.manifestComplete).toBe(false);
    const completed = reduceCatalogInventory(result.state, input([observation("key", models(1), 2), observation("native", models(1, "native-"), 2)], 2,
      { requiredSourceKeys: ["key", "native"] }));
    expect(completed.removedIds).toEqual(["fixture-1", "fixture-2"]);
  });
  it("requires all required sources in the same cycle, not cached previous success", () => {
    const first = reduceCatalogInventory(undefined, input([observation("key", models(3)), observation("native", models(1, "native-"))], 0,
      { requiredSourceKeys: ["key", "native"] })).state;
    const next = reduceCatalogInventory(first, input([observation("key", models(1), 1)], 1,
      { requiredSourceKeys: ["key", "native"] }));
    expect(next.manifestComplete).toBe(false); expect(next.removedIds).toEqual([]);
  });
  it("never allows public, account or wrong-Key data to grant membership", () => {
    for (const auth of ["anonymous", "site-account", "connection-key"] as const) {
      const row = observation("key", models(2)); row.receipt.spec.authScope.kind = auth;
      if (auth === "connection-key") row.receipt.spec.authScope.principalRef = "connection-other";
      const result = reduceCatalogInventory(undefined, input([row]));
      expect(result.visibleModels).toEqual([]); expect(result.state.sources).toEqual({}); expect(result.manifestComplete).toBe(false);
    }
    const publicCatalog = observation("key", models(2)); publicCatalog.receipt.spec.role = "catalog-offer";
    expect(reduceCatalogInventory(undefined, input([publicCatalog])).visibleModels).toEqual([]);
  });
  it("adds only explicitly validated positive partial IDs and never withdraws", () => {
    const previous = reduce(undefined, models(3), 0).state;
    const partial = observation("key", models(3, "new-"), 1, { complete: false, reason: "incomplete" });
    const without = reduceCatalogInventory(previous, input([partial], 1));
    expect(without.visibleModels).toEqual(models(3));
    const withProof = reduceCatalogInventory(previous, input([partial], 1, { validatedPartialModelIds: { key: ["new-1"] } }));
    expect(withProof.visibleModels.map(m => m.id)).toEqual(["fixture-0", "fixture-1", "fixture-2", "new-1"]);
    expect(withProof.state.sources.key?.baseline?.modelIds).toEqual(models(3).map(m => m.id));
    expect(withProof.removedIds).toEqual([]);
  });
  it("does not treat auth failure, cache/unread, malformed or duplicate rows as positive partial data", () => {
    for (const override of [{ reason: "authentication" as const }, { freshness: "unread" as const }, {}]) {
      const row = observation("key", models(1), 1, { status: "failed", complete: false, reason: "incomplete", ...override });
      if (!Object.keys(override).length) row.facts.models.push(row.facts.models[0]!);
      const result = reduceCatalogInventory(undefined, input([row], 1, { validatedPartialModelIds: { key: ["fixture-0"] } }));
      expect(result.visibleModels).toEqual([]);
    }
  });
  it("requires exact exhaustive Key coverage and rejects a conflict between duplicate logical receipts", () => {
    const row = observation("key", models(2)); row.receipt.coverage!.modelIds = ["fixture-0"];
    expect(reduceCatalogInventory(undefined, input([row])).manifestComplete).toBe(false);
    const a = observation("key", models(2)), b = observation("key", models(1));
    expect(reduceCatalogInventory(undefined, input([a, b])).visibleModels).toEqual([]);
  });
  it("fails closed on non-JSON facts or a contradictory complete/failure receipt", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const invalid = observation("key", [{ ...models(1)[0]!, metadata: cyclic }]);
    expect(reduceCatalogInventory(undefined, input([invalid])).visibleModels).toEqual([]);
    const contradictory = observation("key", models(1), 0, { reason: "authentication" });
    expect(reduceCatalogInventory(undefined, input([contradictory])).visibleModels).toEqual([]);
  });
  it("preserves last full descriptor in history and never rewrites other owners on membership refresh", () => {
    const original: ModelDescriptor[] = [{ ...models(2)[0]!, parameters: [{ key: "quality", label: "质量", control: "text" }],
      pricing: { kind: "per-image", currency: "CNY", unitAmount: 0.3, confidence: "exact", checkedAt: at(0) } }, models(2)[1]!];
    const first = reduce(undefined, original, 0);
    const next = reduce(first.state, [models(2)[0]!], 1);
    expect(next.visibleModels[0]).toEqual(original[0]); expect(next.historicalModels[0]?.descriptor).toEqual(original[1]);
    expect(next.historicalModels[0]?.sourceKeys).toEqual(["key"]);
    const restored = reduce(next.state, models(2), 2);
    expect(restored.visibleModels[0]).toEqual(original[0]); expect(restored.historicalModels).toEqual(next.historicalModels);
  });
});

describe("catalog trusted baselines, independent cycles and manual confirmation", () => {
  it("retains 100 as baseline through 100→40→40, accepting only the third daily candidate", () => {
    let state = reduce(undefined, models(100), 0).state;
    for (const day of [1, 2]) {
      const result = reduce(state, models(40), day); state = result.state;
      expect(state.sources.key?.baseline?.modelIds).toHaveLength(100);
      expect(state.sources.key?.candidate?.countedCycles).toHaveLength(day);
      expect(result.removedIds).toEqual([]); expect(result.visibleModels).toHaveLength(100);
    }
    const final = reduce(state, models(40), 3);
    expect(final.state.sources.key?.candidate).toBeUndefined(); expect(final.visibleModels).toHaveLength(40);
    expect(final.removedIds).toHaveLength(60); expect(final.historicalModels).toHaveLength(60);
  });
  it("does not count retries, duplicate cycles, or different cycles less than 24 hours apart", () => {
    const first = reduce(undefined, models(100), 0).state;
    const candidate = reduce(first, models(40), 1).state;
    const retry = observation("key", models(40), 1); retry.receipt.context.dispatchSeq++;
    const retried = reduceCatalogInventory(candidate, input([retry], 1)).state;
    expect(retried.sources.key?.candidate?.countedCycles).toEqual(["cycle-1"]);
    const early = reduce(retried, models(40), 1.5);
    expect(early.state.sources.key?.candidate?.countedCycles).toEqual(["cycle-1"]);
    const enough = reduce(early.state, models(40), 2);
    expect(enough.state.sources.key?.candidate?.countedCycles).toEqual(["cycle-1", "cycle-2"]);
  });
  it("does not count manual or upgrade observations as independent daily confirmation", () => {
    let state = reduce(undefined, models(100), 0).state;
    state = reduce(state, models(40), 1, { mode: "upgrade" }).state;
    state = reduce(state, models(40), 2, { mode: "manual" }).state;
    expect(state.sources.key?.candidate?.countedCycles).toEqual([]); expect(state.visibleModels).toHaveLength(100);
  });
  it("restarts the candidate version and count when the candidate collection changes", () => {
    const first = reduce(undefined, models(100), 0).state;
    const second = reduce(first, models(40), 1).state;
    const third = reduce(second, models(39), 2);
    expect(third.state.sources.key?.candidate?.countedCycles).toEqual(["cycle-2"]);
    expect(third.state.sources.key?.candidate?.version).not.toBe(second.sources.key?.candidate?.version);
    expect(third.state.sources.key?.baseline?.modelIds).toHaveLength(100);
  });
  it("breaks continuity on incomplete results and never automatically accepts hard truncation", () => {
    let state = reduce(undefined, models(100), 0).state;
    state = reduce(state, models(40), 1).state;
    const oldVersion = state.sources.key?.candidate?.version;
    for (const day of [2, 3, 4]) {
      const row = observation("key", models(40), day, { complete: false, reason: "incomplete" });
      const result = reduceCatalogInventory(state, input([row], day)); state = result.state;
      expect(state.sources.key?.candidate).toBeUndefined(); expect(result.visibleModels).toHaveLength(100);
    }
    const fresh = reduce(state, models(40), 5);
    expect(fresh.state.sources.key?.candidate?.countedCycles).toHaveLength(1);
    expect(fresh.state.sources.key?.candidate?.version).not.toBe(oldVersion);
  });
  it("breaks continuity when a required source has no receipt in a newer cycle", () => {
    const first = reduce(undefined, models(100), 0).state;
    const second = reduce(first, models(40), 1).state;
    const missing = reduceCatalogInventory(second, input([], 2, { finalizeCycle: true }));
    expect(missing.state.sources.key?.candidate).toBeUndefined(); expect(missing.manifestComplete).toBe(false);
    const next = reduce(missing.state, models(40), 3);
    expect(next.state.sources.key?.candidate?.countedCycles).toEqual(["cycle-3"]);
  });
  it("does not break sibling candidates while tasks in the current cycle are still pending", () => {
    let state = reduceCatalogInventory(undefined, input([observation("key", models(100)), observation("native", models(100, "native-"))], 0,
      { requiredSourceKeys: ["key", "native"] })).state;
    for (const day of [1, 2, 3]) {
      const a = observation("key", models(40), day), b = observation("native", models(40, "native-"), day);
      state = reduceCatalogInventory(state, input([a], day, { requiredSourceKeys: ["key", "native"] })).state;
      state = reduceCatalogInventory(state, input([a, b], day, { requiredSourceKeys: ["key", "native"] })).state;
      if (day < 3) expect(state.sources.native?.candidate?.countedCycles).toHaveLength(day);
    }
    expect(state.visibleModels).toHaveLength(80); expect(state.sources.native?.candidate).toBeUndefined();
  });
  it("resets candidate after the baseline members reappear", () => {
    const first = reduce(undefined, models(100), 0).state;
    const second = reduce(first, models(40), 1).state;
    const restored = reduce(second, models(100), 2);
    expect(restored.state.sources.key?.candidate).toBeUndefined(); expect(restored.manifestComplete).toBe(true);
  });
  it("manual confirmation binds to the latest candidate version without a request", () => {
    const first = reduce(undefined, models(100), 0).state;
    const candidate = reduce(first, models(40), 1).state;
    const result = reduceCatalogInventory(candidate, input([], 1, { mode: "manual", manualConfirmation: {
      sourceKey: "key", candidateVersion: candidate.sources.key!.candidate!.version } }));
    expect(result.manualConfirmation).toBe("accepted"); expect(result.manifestComplete).toBe(true);
    expect(result.visibleModels).toHaveLength(40); expect(result.removedIds).toHaveLength(60);
  });
  it("does not let manual source confirmation bypass a failed required sibling source", () => {
    const first = reduceCatalogInventory(undefined, input([observation("key", models(100)), observation("native", models(1, "native-"))], 0,
      { requiredSourceKeys: ["key", "native"] })).state;
    const second = reduceCatalogInventory(first, input([observation("key", models(40), 1),
      observation("native", [], 1, { status: "failed", complete: false, reason: "network" })], 1,
    { requiredSourceKeys: ["key", "native"] })).state;
    const result = reduceCatalogInventory(second, input([], 1, { mode: "manual", requiredSourceKeys: ["key", "native"],
      manualConfirmation: { sourceKey: "key", candidateVersion: second.sources.key!.candidate!.version } }));
    expect(result.manualConfirmation).toBe("accepted"); expect(result.manifestComplete).toBe(false); expect(result.removedIds).toEqual([]);
  });
  it("rejects stale candidate tokens, cleared candidates and changed identity epochs", () => {
    const first = reduce(undefined, models(100), 0).state;
    const second = reduce(first, models(40), 1).state, version = second.sources.key!.candidate!.version;
    const changed = reduce(second, models(39), 2).state;
    const stale = reduceCatalogInventory(changed, input([], 2, { mode: "manual", manualConfirmation: { sourceKey: "key", candidateVersion: version } }));
    expect(stale.manualConfirmation).toBe("rejected"); expect(stale.removedIds).toEqual([]);
    const epoch = reduceCatalogInventory(second, input([], 2, { identityEpoch: "epoch-2", mode: "manual",
      manualConfirmation: { sourceKey: "key", candidateVersion: version } }));
    expect(epoch.manualConfirmation).toBe("rejected"); expect(epoch.state.sources.key?.baseline?.modelIds).toHaveLength(100);
    expect(epoch.state.sources.key?.candidate?.version).not.toBe(version); expect(epoch.visibleModels).toHaveLength(100);
    const hard = reduceCatalogInventory(second, input([observation("key", models(40), 2, { complete: false, reason: "incomplete" })], 2)).state;
    expect(reduceCatalogInventory(hard, input([], 2, { mode: "manual", manualConfirmation: { sourceKey: "key", candidateVersion: version } })).manualConfirmation).toBe("rejected");
  });
  it("ignores stale sequence and out-of-order time without replacing the accepted collection", () => {
    const first = reduce(undefined, models(3), 1).state;
    const stale = observation("key", models(1), 2); stale.receipt.context.dispatchSeq = 1;
    const result = reduceCatalogInventory(first, input([stale], 2));
    expect(result.visibleModels).toEqual(models(3)); expect(result.sourceResults[0]?.outcome).toBe("ignored");
    expect(reduce(first, models(1), 0).state).toEqual(first);
  });
  it("does not mutate inputs or preserve a baseline when source scope changes under the same key", () => {
    const first = reduce(undefined, models(100), 0).state, before = structuredClone(first);
    const changed = observation("key", models(40), 1); changed.receipt.spec.authScope.credentialEpoch = "credential-2";
    const snapshot = structuredClone(changed), result = reduceCatalogInventory(first, input([changed], 1));
    expect(first).toEqual(before); expect(changed).toEqual(snapshot);
    expect(result.state.sources.key?.candidate).toBeUndefined(); expect(result.state.sources.key?.baseline?.modelIds).toHaveLength(40);
  });
  it("preserves the exact source baseline across a supplier namespace epoch rotation", () => {
    const original = reduce(undefined, models(100), 0).state;
    const row = observation("key", models(40), 1); row.receipt.context.identityEpoch = "epoch-2";
    const result = reduceCatalogInventory(original, input([row], 1, { identityEpoch: "epoch-2" }));
    expect(result.state.sources.key?.baseline?.modelIds).toHaveLength(100);
    expect(result.state.sources.key?.candidate?.countedCycles).toEqual(["cycle-1"]);
    expect(result.state.sources.key?.lastIdentityEpoch).toBe("epoch-2");
    expect(result.manifestComplete).toBe(false); expect(result.visibleModels).toHaveLength(100); expect(result.removedIds).toEqual([]);
  });
  it("does not treat a preserved old-epoch receipt as a fresh complete manifest", () => {
    const original = reduce(undefined, models(100), 0).state;
    const rotated = reduceCatalogInventory(original, input([], 0, { identityEpoch: "epoch-2" }));
    expect(rotated.state.sources.key?.baseline?.modelIds).toHaveLength(100);
    expect(rotated.state.sources.key?.lastIdentityEpoch).toBe("epoch-1"); expect(rotated.manifestComplete).toBe(false);
    const again = reduceCatalogInventory(rotated.state, input([], 0, { identityEpoch: "epoch-2" }));
    expect(again.manifestComplete).toBe(false);
  });
  it("never borrows a different credential source's baseline across namespace epochs", () => {
    const original = reduce(undefined, models(100), 0).state;
    const row = observation("key", models(40), 1); row.receipt.context.identityEpoch = "epoch-2";
    row.receipt.spec.authScope.credentialEpoch = "changed-key";
    const result = reduceCatalogInventory(original, input([row], 1, { identityEpoch: "epoch-2" }));
    expect(result.state.sources.key?.baseline?.modelIds).toHaveLength(40); expect(result.state.sources.key?.candidate).toBeUndefined();
    expect(result.manifestComplete).toBe(true);
  });
  it("rotates candidate tokens and requires fresh same-source evidence before any new-epoch confirmation", () => {
    const original = reduce(undefined, models(100), 0).state, candidate = reduce(original, models(40), 1).state;
    const oldVersion = candidate.sources.key!.candidate!.version;
    const rotated = reduceCatalogInventory(candidate, input([], 2, { identityEpoch: "epoch-2" }));
    const newVersion = rotated.state.sources.key!.candidate!.version;
    expect(newVersion).not.toBe(oldVersion); expect(rotated.state.sources.key?.candidate?.countedCycles).toEqual([]);
    for (const version of [oldVersion, newVersion]) {
      const confirm = reduceCatalogInventory(rotated.state, input([], 2, { identityEpoch: "epoch-2", mode: "manual",
        manualConfirmation: { sourceKey: "key", candidateVersion: version } }));
      expect(confirm.manualConfirmation).toBe("rejected"); expect(confirm.removedIds).toEqual([]);
    }
    const fresh = observation("key", models(40), 3); fresh.receipt.context.identityEpoch = "epoch-2";
    const observed = reduceCatalogInventory(rotated.state, input([fresh], 3, { identityEpoch: "epoch-2" }));
    expect(observed.state.sources.key?.baseline?.modelIds).toHaveLength(100);
    expect(observed.state.sources.key?.candidate?.countedCycles).toEqual(["cycle-3"]);
    expect(reduceCatalogInventory(observed.state, input([], 3, { identityEpoch: "epoch-2", mode: "manual",
      manualConfirmation: { sourceKey: "key", candidateVersion: newVersion } })).manualConfirmation).toBe("accepted");
  });
});
