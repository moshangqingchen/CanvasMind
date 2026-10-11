import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { MemoryRepository } from "@super-canvas/db";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import fixture from "../../../lib/fixtures/c-retained-price-actual-remaining-five-v2.json";
import sourceExpectations from "../../../lib/fixtures/c-retained-r6-source-expectations.json";
import type { ModelDescriptor } from "@super-canvas/providers";
import { applyUserImageSizePresets, userImageSizeOptions } from "@super-canvas/providers/image-size-presets";
import type { ImageSizeTier } from "@super-canvas/providers/image-size-presets";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, upstream: vi.fn() }));
vi.mock("../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@super-canvas/providers", async original => ({ ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.upstream, discoverSupplierCatalog: mocks.upstream, scanProviderModelCatalog: mocks.upstream }));
import { readProviderModelInventory } from "../../../lib/provider-model-inventory";

const migrationUrl = new URL("../../../lib/fixtures/c-retained-exact-group-migration.json", import.meta.url);
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : value;
const canonical = (value: unknown) => JSON.stringify(normalize(value)) ?? "undefined";
const sha = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const priceKeys = ["priceLabel", "priceSource", "priceStatus", "priceCheckedAt", "priceLastAttemptAt", "priceLastAttemptStatus", "supplierPriceGroup", "supplierPriceGroupId"];
const userPresetKeys = ["imageUserSizePresets", "imageUserSizePresetSource", "imageUserSizePresetTiers", "imageUserSizePresetParameter", "imageUserSizeSourceOptions", "imageUserSizeSourceDescription", "imageUserQualityPresets", "imageUserQualityPresetSource", "imageUserQualitySourceParameter", "imageApplicationQualityDefault"];
type Migration = { targets: { connectionId: string; fieldsMayMigrate: string[]; modelExpectedMetadata: { fullModelId: string; expected: Record<string, unknown>; expectedAbsent: string[] }[] }[] };
const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
function assertR6SourceContract(model: ModelDescriptor, origin: string, group: string) {
  const parameter = (key: string) => model.parameters?.find(row => row.key === key);
  const values = (key: string) => parameter(key)?.options?.map(option => option.value);
  if (!model.operations.includes("image.generate")) return;
  expect(model.metadata?.imageNativeParameterContract).toBe(true);
  expect(model.metadata?.imageResolutionProfiles).toBeUndefined();
  if (origin === "https://vapi.chuangxiangai.asia" && group === "生图") {
    if (/^gpt-image-2(?:\.5-(?:flare|sunburst))?-[124]k$/u.test(model.id)) {
      const tier = model.id.match(/-([124])k$/u)![1]! + "K", image25 = model.id.includes("2.5-");
      expect(model.metadata?.imageSupportedResolutions).toEqual([tier]);
      expect(values("aspect_ratio")).toEqual(["auto", ...ratios]);
      expect(parameter("quality")?.default).toBe(image25 ? "max" : "high");
      expect(values("quality")).toEqual(image25 ? ["auto", "medium", "max"] : ["auto", "low", "medium", "high"]);
      expect(parameter("n")).toMatchObject({ default: 1, min: 1, max: 1 });
      expect(model.limits).toMatchObject({ maxInputImages: 9, maxOutputImages: 1 });
      expect(parameter("size")?.allowCustomValue).toBe(true);
      if (image25) {
        const targets = tier === "1K" ? ["1024x1024", "1280x720", "720x1280"] : tier === "2K" ? ["2048x2048", "2560x1440", "1440x2560"] : ["2880x2880", "3840x2160", "2160x3840"];
        const sourceWithPresets = applyUserImageSizePresets({ ...model, parameters: model.parameters?.map(row => row.key === "size"
          ? { ...row, options: ["auto", ...targets].map(value => ({ value, label: value })) } : row) });
        expect(values("size")).toEqual(sourceWithPresets.parameters?.find(row => row.key === "size")?.options?.map(option => option.value));
        expect(model.metadata).toMatchObject({ imageUserSizePresetSource: "user-request", imageUserSizePresetTiers: [tier] });
        expect(parameter("size")).toMatchObject({ min: 16, max: 3840, step: 16 });
        expect(model.metadata?.imageSupplierQualityDefault).toBe("medium");
      } else {
        const sourceOptions = model.metadata?.imageUserSizeSourceOptions as { value: string }[];
        expect(sourceOptions.map(option => option.value)).toEqual(["auto", ...ratios]);
        expect(values("size")).toEqual([...userImageSizeOptions([tier as ImageSizeTier]).map(option => option.value), ...ratios]);
        expect(model.metadata).toMatchObject({ imageUserSizePresetSource: "user-request", imageUserSizePresetTiers: [tier] });
        expect(parameter("size")?.options?.filter(option => option.label.startsWith(`${tier} · `))).toHaveLength(11);
        for (const key of ["min", "max", "step"] as const) expect(parameter("size")?.[key]).toBeUndefined();
      }
    } else if (/^midjourney-[12]k$/u.test(model.id)) {
      expect(values("size")).toEqual(["auto", ...ratios]);
      expect(values("speed")).toEqual(["relax", "fast"]);
      expect(values("reference")).toEqual(["auto", "image", "style", "edit", "moodboard", "editor"]);
      expect(model.limits?.maxInputImages).toBeUndefined();
      expect(model.limits?.maxOutputImages).toBe(4);
      expect(model.metadata?.midjourneyReferenceLimits).toEqual({ edit: 4, editor: 1 });
      expect(parameter("n")).toMatchObject({ min: 1, max: 1 });
    } else {
      expect(/^nano-banana(?:2|-pro)-[124]k$|^gemini-(?:3-pro|3\.1-flash)-image-preview$/u.test(model.id)).toBe(true);
      const fixed = model.id.match(/-([124])k$/u)?.[1];
      expect(values("image_size")).toEqual(fixed ? [fixed + "K"] : ["1K", "2K", "4K"]);
      expect(parameter("image_size")?.default).toBe(fixed ? fixed + "K" : "4K");
      expect(values("aspect_ratio")).toEqual(["auto", ...ratios]);
      expect(model.limits).toMatchObject({ maxInputImages: 9, maxOutputImages: 1 });
      expect(parameter("quality")).toBeUndefined();
    }
  } else if (origin === "https://genimage.pro" && model.id.startsWith("gemini-")) {
    const flash = model.id === "gemini-3.1-flash-image-preview", pro = model.id === "gemini-3-pro-image-preview", omit = model.id === "gemini-2.5-flash-image";
    expect(values("image_size")).toEqual(flash ? ["auto", "512", "1K", "2K", "4K"] : pro ? ["auto", "1K", "2K", "4K"] : ["auto"]);
    expect(parameter("image_size")?.default).toBe(flash || pro ? "4K" : "auto");
    expect(parameter("image_size")?.allowCustomValue).toBe(!flash && !pro && !omit);
    expect(parameter("aspect_ratio")?.allowCustomValue).toBe(true);
    expect(values("aspect_ratio")?.length).toBe(flash ? 15 : pro ? 11 : 1);
    expect(model.limits?.maxInputImages).toBeUndefined(); // 14 is an adapter bound, not this exact supplier declaration.
    expect(model.limits?.maxOutputImages).toBe(1);
    expect(parameter("n")).toMatchObject({ min: 1, max: 1 });
    expect(parameter("quality")).toBeUndefined();
    expect(model.metadata?.bananaInputLimitSource).toBe("adapter");
  } else if (origin === "https://genimage.pro") {
    expect(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]).toContain(model.id);
    expect(values("size")).toEqual([...userImageSizeOptions().map(option => option.value), "1K", "2K", "4K"]);
    expect(model.metadata?.imageUserSizePresetSource).toBe("user-request");
    expect(parameter("size")?.allowCustomValue).toBe(true);
    for (const key of ["min", "max", "step"] as const) expect(parameter("size")?.[key]).toBeUndefined();
    expect(parameter("quality")).toMatchObject({ control: "select", allowCustomValue: true, default: model.id === "gpt-image-2" ? "high" : "max" });
    expect(model.metadata?.imageSupplierQualityDefault).toBeNull();
    expect(parameter("n")?.max).toBeUndefined();
    expect(values("response_format")).toEqual(["b64_json", "url"]);
  } else throw new Error(`No source-specific assertion for ${origin}/${group}/${model.id}`);
}
function diffs(before: unknown, after: unknown, pointer = ""): { path: string; before: unknown; after: unknown }[] {
  if (canonical(before) === canonical(after)) return [];
  if (before && after && typeof before === "object" && typeof after === "object") {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => diffs(a[key], b[key], `${pointer}/${key}`));
  }
  return [{ path: pointer, before: before ?? null, after: after ?? null }];
}
function contractDelta(before: ProviderConnectionRecord, after: ProviderConnectionRecord) {
  const keys = ["modelCatalogModels", "connector", "modelProtocolTemplate"] as const;
  const configFields = [...new Set([...Object.keys(before.config), ...Object.keys(after.config)])].filter(key => canonical(before.config[key]) !== canonical(after.config[key]));
  const containers = Object.fromEntries(keys.filter(key => before.config[key] !== undefined || after.config[key] !== undefined).map(key => {
    const oldContainer = before.config[key], newContainer = after.config[key];
    const left = (key === "modelCatalogModels" ? oldContainer : (oldContainer as { models?: unknown } | undefined)?.models) as Record<string, unknown>[] ?? [];
    const right = (key === "modelCatalogModels" ? newContainer : (newContainer as { models?: unknown } | undefined)?.models) as Record<string, unknown>[] ?? [];
    const modelChanges = left.map(old => {
      const next = right.find(row => row.id === old.id)!;
      const fields = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(field => canonical(old[field]) !== canonical(next[field]));
      const topLevel = Object.fromEntries(fields.filter(field => field !== "metadata").map(field => [field, { before: old[field], after: next[field] }]));
      const a = (old.metadata ?? {}) as Record<string, unknown>, b = (next.metadata ?? {}) as Record<string, unknown>;
      const metadata = Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].filter(field => canonical(a[field]) !== canonical(b[field])).map(field => [field, { before: a[field], after: b[field] }]));
      return { id: old.id, fields, topLevel, metadata };
    }).filter(row => row.fields.length);
    return [key, { beforeIds: left.map(row => row.id), afterIds: right.map(row => row.id), beforeSha256: sha(oldContainer), afterSha256: sha(newContainer), modelChanges,
      nonModelContractChanged: key !== "modelCatalogModels" && canonical({ ...(oldContainer as object), models: undefined }) !== canonical({ ...(newContainer as object), models: undefined }) }];
  }));
  return { configFields, containers, absentContainersUnchanged: keys.filter(key => before.config[key] === undefined && after.config[key] === undefined),
    allConfigCanonicalBeforeSha256: sha(before.config), allConfigCanonicalAfterSha256: sha(after.config) };
}
function maskAndVerify(before: ProviderConnectionRecord, after: ProviderConnectionRecord, migration: Migration) {
  const left = structuredClone(before), right = structuredClone(after), approved = migration.targets.find(row => row.connectionId === before.id);
  delete (left as Partial<ProviderConnectionRecord>).updatedAt; delete (right as Partial<ProviderConnectionRecord>).updatedAt;
  const sourcedDelta: { container: string; fullModelId: string; field: string; before: unknown; after: unknown; expected: unknown }[] = [];
  for (const container of ["modelCatalogModels", "connector", "modelProtocolTemplate"] as const) {
    const a = (container === "modelCatalogModels" ? left.config[container] : (left.config[container] as { models?: unknown } | undefined)?.models) as Record<string, unknown>[] | undefined;
    const b = (container === "modelCatalogModels" ? right.config[container] : (right.config[container] as { models?: unknown } | undefined)?.models) as Record<string, unknown>[] | undefined;
    if (!a || !b) continue;
    expect(a.map(row => row.id)).toEqual(b.map(row => row.id));
    for (let i = 0; i < a.length; i++) {
      const source = sourceExpectations.rows.find(row => row.connectionId === before.id && row.fullModelId === a[i]!.id)!;
      expect(source).toBeDefined();
      const sourceMetadata = source.metadata as ModelDescriptor["metadata"];
      const exactChuangxiangQuality = source.origin === "https://vapi.chuangxiangai.asia" && source.group === "生图" &&
        /^gpt-image-2(?:\.5-(?:flare|sunburst))?-[124]k$/u.test(source.fullModelId);
      const sourceWithPresets = applyUserImageSizePresets({ ...(b[i] as unknown as ModelDescriptor),
        parameters: source.parameters as ModelDescriptor["parameters"], metadata: { ...sourceMetadata,
          ...(exactChuangxiangQuality ? { imageQualityOptionsCompleteEnum: source.fullModelId.includes("2.5-"),
            imageFixedResolution: source.fullModelId.match(/-([124])k$/u)![1]! + "K" } : {}),
          ...(sourceMetadata?.imageResolutionMode === "fixed-model-tier" && Array.isArray(sourceMetadata.imageSupportedResolutions)
            ? { imageFixedResolution: sourceMetadata.imageSupportedResolutions[0] } : {}),
        } });
      if (source.imageContract) {
        assertR6SourceContract(b[i] as unknown as ModelDescriptor, source.origin, source.group);
        // Literal, source-specific descriptor expectation is checked before masking.
        // This never permits arbitrary parameter/schema changes.
        expect(b[i]!.parameters).toEqual(sourceWithPresets.parameters);
        expect(b[i]!.limits).toEqual(source.limits);
        a[i]!.parameters = structuredClone(b[i]!.parameters);
        if (Object.hasOwn(b[i]!, "limits")) a[i]!.limits = structuredClone(b[i]!.limits);
        else delete a[i]!.limits;
      }
      delete a[i]!.pricing; delete b[i]!.pricing;
      const am = (a[i]!.metadata ?? {}) as Record<string, unknown>, bm = (b[i]!.metadata ?? {}) as Record<string, unknown>;
      for (const field of priceKeys) { delete am[field]; delete bm[field]; }
      if (source.imageContract) for (const field of [...sourceExpectations.documentedImageMetadataFields, ...userPresetKeys,
        ...(exactChuangxiangQuality ? ["imageQualityOptionsCompleteEnum"] : [])]) {
        if (canonical(am[field]) === canonical(bm[field])) continue;
        const expected = sourceWithPresets.metadata?.[field];
        expect(bm[field], `${source.fullModelId}:${field}`).toEqual(expected);
        sourcedDelta.push({ container, fullModelId: source.fullModelId, field, before: am[field] ?? null, after: bm[field] ?? null, expected: expected ?? null });
        if (Object.hasOwn(bm, field)) am[field] = structuredClone(bm[field]); else delete am[field];
      }
      const exact = approved?.modelExpectedMetadata.find(row => row.fullModelId === a[i]!.id);
      for (const field of approved?.fieldsMayMigrate ?? []) {
        if (canonical(am[field]) === canonical(bm[field])) continue;
        sourcedDelta.push({ container, fullModelId: String(a[i]!.id), field, before: am[field] ?? null, after: bm[field] ?? null, expected: exact?.expected[field] ?? null });
        expect(Object.hasOwn(am, field)).toBe(false);
        expect(exact && Object.hasOwn(exact.expected, field)).toBe(true);
        expect(bm[field]).toEqual(exact!.expected[field]);
        am[field] = structuredClone(bm[field]);
      }
      a[i]!.metadata = am; b[i]!.metadata = bm;
    }
  }
  return { illegal: diffs(left, right).map(row => ({ path: row.path, beforeSha256: sha(row.before), afterSha256: sha(row.after),
    beforeType: typeof row.before, afterType: typeof row.after })), sourcedDelta };
}
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.upstream.mockReset().mockRejectedValue(new Error("Actual saved contract mock must not contact upstream"));
  vi.stubGlobal("fetch", mocks.upstream);
});
afterEach(() => { expect(mocks.upstream).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("actual immutable five saved C contracts use offline ordinary GET without unapproved migrations", () => {
  it("preserves complete raw config, all 38 descriptors and templates; exact-source migration and idempotence are recorded", async () => {
    const migration = JSON.parse(await readFile(migrationUrl, "utf8")) as Migration;
    expect(fixture.sourceDatabaseSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(fixture.redactions).toHaveLength(5);
    expect(fixture.unchangedUrlSpellingsPreserved).toBe(true);
    expect(fixture.suppliers.every(supplier => !["siteLogin", "billing", "keySync", "history"].some(key => Object.hasOwn(supplier.state, key)))).toBe(true);
    expect(fixture.connections).toHaveLength(5);
    expect(fixture.connections.reduce((count, connection) => count + connection.config.modelCatalogModels.length, 0)).toBe(38);
    for (const supplier of fixture.suppliers) await mocks.repository.saveSupplier(supplier as unknown as SupplierRecord);
    for (const connection of fixture.connections) await mocks.repository.saveConnection(connection as unknown as ProviderConnectionRecord);
    const official = await mocks.repository.listSuppliers();
    const results = [];
    for (const input of fixture.connections) {
      const stages = [];
      for (let stage = 1; stage <= 3; stage++) {
        const before = (await mocks.repository.getConnection(input.id))!;
        const save = vi.spyOn(mocks.repository, "saveConnection");
        const response = await readProviderModelInventory(new Request(`http://localhost/api/providers/${input.id}/models`), { params: Promise.resolve({ id: input.id }) });
        const api = await response.json();
        const after = (await mocks.repository.getConnection(input.id))!;
        const change = maskAndVerify(before, after, migration);
        stages.push({ stage, http: response.status, saveCount: save.mock.calls.length, beforeSha256: sha(before), afterSha256: sha(after),
          canonicalDelta: diffs(before, after).filter(row => row.path !== "/updatedAt").map(row => ({ path: row.path, before: row.before, after: row.after })),
          illegalDelta: change.illegal, exactSourceMetadataDelta: change.sourcedDelta,
          contractDelta: contractDelta(before, after),
          returnedFullModelIds: Array.isArray(api) ? api.map((row: { id: string }) => row.id) : [],
          returnedAndSavedPricingEqual: Array.isArray(api) && canonical(api.map((row: { pricing?: unknown }) => row.pricing)) === canonical((after.config.modelCatalogModels as unknown as { pricing?: unknown }[]).map(row => row.pricing)) });
        save.mockRestore();
      }
      results.push({ connectionId: input.id, sourceId: input.config.supplierSourceId, group: input.config.accountKeyGroup,
        modelCount: input.config.modelCatalogModels.length, rawConfigWasNotPreboundOrSimplified: true, stages,
        savesByStage: stages.map(stage => stage.saveCount), firstStageIllegalDelta: stages[0]!.illegalDelta,
        sourceDelta: { firstGet: stages[0]!.contractDelta, secondGet: stages[1]!.contractDelta, thirdGet: stages[2]!.contractDelta } });
    }
    const passed = results.every(result => result.stages.every(stage => stage.http === 200 && stage.illegalDelta.length === 0 && stage.returnedAndSavedPricingEqual) && result.stages[2]!.saveCount === 0);
    const report = { at: new Date().toISOString(), passed, immutableSourceDatabaseSha256: fixture.sourceDatabaseSha256,
      fixturePath: "apps/desktop/renderer/lib/fixtures/c-retained-price-actual-remaining-five-v2.json", fixtureSha256: createHash("sha256").update(await readFile(new URL("../../../lib/fixtures/c-retained-price-actual-remaining-five-v2.json", import.meta.url))).digest("hex"),
      actualTargetCount: 5, actualWholeModelCount: 38, actualRawConfigConnectorAndTemplateUsed: true, preboundFixture: false,
      results, sameSourceSupplierCatalogUnchanged: canonical(await mocks.repository.listSuppliers()) === canonical(official),
      networkRequests: mocks.upstream.mock.calls.length, actualApplicationRequests: 0, actualProfileWrites: 0, credentialReadByTest: false,
      actualPaidGeneration: false, actualInstalledApiEvidence: false, independentOfEarlierSyntheticV3Fixture: true };
    expect(results.map(result => result.savesByStage)).toEqual(Array.from({ length: 5 }, () => [1, 0, 0]));
    expect(report.sameSourceSupplierCatalogUnchanged).toBe(true);
    expect(results.flatMap(result => result.stages.flatMap(stage => stage.illegalDelta)), "All non-approved stored fields remain unchanged").toEqual([]);
    expect(report.passed).toBe(true);
    // Successful R6 evidence is opt-in and exclusive; never overwrite the
    // historical R4 proof or turn a failed new probe into an old success.
    if (process.env.C_OLD_FIVE_R6_PROOF_PATH) {
      const target = resolve(process.env.C_OLD_FIVE_R6_PROOF_PATH), allowed = resolve("../../../.codex-temp/supplier-full-document-recheck-20261010/audit-c") + sep;
      if (!target.startsWith(allowed) || !target.endsWith("-safe.json")) throw new Error("R6 proof must stay in audit-c");
      await writeFile(target, JSON.stringify({ ...report, evidenceVersion: "R6-source-convergence-from-original-R4-raw-fixture", sourceExpectations: sourceExpectations.source }, null, 2) + "\n", { flag: "wx" });
    }
  });
});
