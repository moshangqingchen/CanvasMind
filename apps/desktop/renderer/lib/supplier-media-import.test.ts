import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import type { ModelDescriptor, SupplierAccountKeys } from "@super-canvas/providers";
import { planSupplierAgentMediaImport } from "./supplier-media-import";

const oldTime = "2026-10-10T00:00:00Z", startedAt = "2026-10-10T01:00:00Z", checkedAt = "2026-10-10T01:00:01Z";
const image: ModelDescriptor = { id: "exact-image", name: "Image", operations: ["image.generate", "image.edit"], outputKinds: ["image"],
  parameters: [{ key: "quality", label: "Quality", control: "select", valueType: "string", default: "high", options: [{ label: "high", value: "high" }] }],
  metadata: { outputKindsSource: "declared", modelFactsSource: "supplier-catalog", protocol: "openai-images", endpointTypes: ["openai-images"], canvasRunnable: true } };

function fixture() {
  const supplier = { id: "supplier", supplierKey: "custom-supplier", name: "Supplier", siteUrl: "https://supplier.example.test", apiUrl: "https://supplier.example.test/v1",
    scanStatus: "live", scanComplete: true, state: { sourceId: "source", visibility: "visible" }, catalog: { groups: [
      { id: "group", label: "Group", supplierGroupId: "10", source: "catalog", status: "available", models: [] },
    ] } } as unknown as SupplierRecord;
  const before: ProviderConnectionRecord = { id: "agent", name: "Keep agent", provider: "rest", encryptedSecret: "sealed-key", createdAt: oldTime, updatedAt: oldTime,
    config: { supplierId: supplier.id, supplierSourceId: "source", baseUrl: supplier.apiUrl, usage: "agent", modelGroup: "group", accountKeyGroup: "group",
      accountKeyGroupId: "10", accountKeyId: "1", protocol: "responses", defaultModel: "text", modelNames: { text: "Keep label" },
      manualModels: [], allowedModels: ["text"], modelScanRequestId: "old-scan", modelScanStatus: "live", modelScanComplete: true,
      modelScanCheckedAt: oldTime, modelScanLastSuccessAt: oldTime, scannedModelIds: ["text"], modelCatalogModels: [] } };
  const after: ProviderConnectionRecord = { ...structuredClone(before), updatedAt: checkedAt, config: { ...structuredClone(before.config),
    modelScanRequestId: "new-scan", modelScanStatus: "live", modelScanAttemptStatus: "live", modelScanComplete: true, modelCatalogSource: "live",
    modelScanCheckedAt: checkedAt, modelScanLastSuccessAt: checkedAt, scannedModelIds: ["text", image.id], modelCatalogModels: [
      { id: "text", name: "Text", operations: [], outputKinds: ["text"] }, structuredClone(image),
    ] } };
  const account: SupplierAccountKeys = { keys: [{ id: "1", group: "group", supplierGroupId: "10", apiKey: "fixture-key", name: "Key" }],
    complete: true, skipped: 0, checkedAt };
  const options = { startedAt, initialConnections: [before], matchesKey: (_connection: ProviderConnectionRecord, key: string): boolean => key === "fixture-key" };
  return { supplier, before, after, account, options };
}
const plan = (f: ReturnType<typeof fixture>, records: ProviderConnectionRecord[] = [f.after]) =>
  planSupplierAgentMediaImport(f.supplier, records, f.account, [{ before: f.before, after: f.after }], f.options);

describe("same-Key agent media supplementation", () => {
  it("reuses the saved ciphertext after fresh declarations without changing the original agent and is idempotent", () => {
    const f = fixture(), original = structuredClone({ supplier: f.supplier, before: f.before, after: f.after });
    const result = plan(f);
    expect(result.addedIds).toHaveLength(1);
    expect(result.connections[0]).toEqual(f.after);
    expect(result.connections[1]).toMatchObject({ provider: "openai", encryptedSecret: f.after.encryptedSecret,
      config: { usage: "canvas", defaultModel: image.id, supplierId: f.supplier.id, supplierSourceId: "source", accountKeyId: "1",
        accountKeyGroupId: "10", modelScanStatus: "live", modelScanComplete: true, scannedModelIds: ["text", image.id],
        supplierMediaSourceConnectionId: f.after.id } });
    expect(result.connections[1]!.config).not.toHaveProperty("supplierVerificationRequestId");
    expect(result.connections[1]!.config).not.toHaveProperty("allowedModels");
    expect(result.connections[1]!.config).not.toHaveProperty("directorProtocol");
    expect(f.supplier).toEqual(original.supplier);
    expect(f.before).toEqual(original.before);
    expect(f.after).toEqual(original.after);
    const repeated = plan(f, result.connections);
    expect(repeated.addedIds).toEqual([]);
    expect(repeated.connections).toEqual(result.connections);
  });

  it.each([
    ["incomplete account", (f: ReturnType<typeof fixture>) => { f.account.complete = false; }],
    ["failed supplier", (f: ReturnType<typeof fixture>) => { f.supplier.scanStatus = "failed"; }],
    ["incomplete supplier", (f: ReturnType<typeof fixture>) => { f.supplier.scanComplete = false; }],
    ["deleted supplier", (f: ReturnType<typeof fixture>) => { f.supplier.state!.visibility = "deleted"; }],
    ["source changed", (f: ReturnType<typeof fixture>) => { f.supplier.state!.sourceId = "replacement"; }],
    ["Key mismatch", (f: ReturnType<typeof fixture>) => { f.options.matchesKey = () => false; }],
    ["Key record mismatch", (f: ReturnType<typeof fixture>) => { f.account.keys[0]!.id = "2"; }],
    ["account group reassigned", (f: ReturnType<typeof fixture>) => { f.account.keys[0]!.supplierGroupId = "20"; }],
    ["partial Key directory", (f: ReturnType<typeof fixture>) => { f.after.config.modelScanComplete = false; }],
    ["stale directory", (f: ReturnType<typeof fixture>) => { f.after.config.modelCatalogSource = "saved"; }],
    ["latest attempt failed", (f: ReturnType<typeof fixture>) => { f.after.config.modelScanAttemptStatus = "failed"; }],
    ["old success", (f: ReturnType<typeof fixture>) => { f.after.config.modelScanLastSuccessAt = oldTime; }],
    ["before this scan", (f: ReturnType<typeof fixture>) => { f.after.config.modelScanCheckedAt = oldTime; f.after.config.modelScanLastSuccessAt = oldTime; }],
    ["invalid scan start", (f: ReturnType<typeof fixture>) => { f.options.startedAt = "invalid"; }],
    ["old request identity", (f: ReturnType<typeof fixture>) => { f.after.config.modelScanRequestId = f.before.config.modelScanRequestId; }],
    ["stale official group", (f: ReturnType<typeof fixture>) => { f.supplier.catalog.groups[0]!.details = { source: "key-groups", stale: true }; }],
    ["missing official group", (f: ReturnType<typeof fixture>) => { f.supplier.catalog.groups[0]!.status = "missing"; }],
    ["ambiguous official group", (f: ReturnType<typeof fixture>) => { f.supplier.catalog.groups.push({ ...f.supplier.catalog.groups[0]!, id: "duplicate" }); }],
    ["name-only inferred media", (f: ReturnType<typeof fixture>) => { const models = f.after.config.modelCatalogModels as unknown as ModelDescriptor[]; models[1]!.metadata = { ...models[1]!.metadata, outputKindsSource: "inferred" }; }],
    ["missing parameter schema", (f: ReturnType<typeof fixture>) => { (f.after.config.modelCatalogModels as unknown as ModelDescriptor[])[1]!.parameters = []; }],
    ["no declared endpoint", (f: ReturnType<typeof fixture>) => { const model = (f.after.config.modelCatalogModels as unknown as ModelDescriptor[])[1]!; model.metadata = { ...model.metadata, endpointTypes: [] }; }],
    ["interface incomplete", (f: ReturnType<typeof fixture>) => { const model = (f.after.config.modelCatalogModels as unknown as ModelDescriptor[])[1]!; model.metadata = { ...model.metadata, autoInterfaceStatus: "incomplete" }; }],
    ["not returned by this Key", (f: ReturnType<typeof fixture>) => { f.after.config.scannedModelIds = ["text"]; }],
    ["agent renamed by user", (f: ReturnType<typeof fixture>) => { f.after.name = "User edited"; }],
    ["user default changed", (f: ReturnType<typeof fixture>) => { f.after.config.defaultModel = "different-text"; }],
    ["agent Key changed", (f: ReturnType<typeof fixture>) => { f.after.encryptedSecret = "new-key"; }],
  ])("does not supplement with %s", (_name, change) => {
    const f = fixture(); change(f);
    expect(plan(f).addedIds).toEqual([]);
  });

  it.each(["canvas", "disabled", "archived"])("honors an existing same-group %s record without merging its Key", mode => {
    const f = fixture();
    const existing = { ...structuredClone(f.before), id: "other", encryptedSecret: "different-key", config: { ...f.before.config,
      usage: mode === "disabled" ? "disabled" : "canvas", ...(mode === "archived" ? { supplierArchived: true } : {}) } };
    const result = plan(f, [f.after, existing]);
    expect(result.addedIds).toEqual([]);
    expect(result.connections).toEqual([f.after, existing]);
  });

  it("does not replace a canvas deleted during the scan", () => {
    const f = fixture();
    f.options.initialConnections.push({ ...f.before, id: "deleted-canvas", config: { ...f.before.config, usage: "canvas" } });
    expect(plan(f).addedIds).toEqual([]);
  });
  it("accepts the scanner filling an unset text default while preserving a previously selected default", () => {
    const f = fixture();
    delete f.before.config.defaultModel;
    expect(plan(f).addedIds).toHaveLength(1);
    f.after.config.defaultModel = image.id;
    expect(plan(f).addedIds).toEqual([]);
  });
  it("does not recreate an automatically supplemented canvas after later deletion or a user group edit", () => {
    const f = fixture();
    const first = plan(f);
    f.supplier.state!.agentMediaImports = first.imports;
    expect(plan(f).addedIds).toEqual([]);
    const moved = { ...first.connections[1]!, config: { ...first.connections[1]!.config, accountKeyGroupId: "20", modelGroup: "moved" } };
    expect(plan(f, [f.after, moved]).addedIds).toEqual([]);
    f.supplier.state!.agentMediaImports = first.imports.map(entry => ({ ...entry, sourceId: "old-source" }));
    expect(plan(f).addedIds).toHaveLength(1);
  });
  it("ignores a removed agent or any later edit to the completed scan snapshot", () => {
    const f = fixture();
    expect(plan(f, []).addedIds).toEqual([]);
    expect(plan(f, [{ ...f.after, name: "Later edit" }]).addedIds).toEqual([]);
    f.options.initialConnections = [];
    expect(plan(f).addedIds).toEqual([]);
  });
  it("keeps same-name groups with different stable IDs and other sources separate", () => {
    const f = fixture();
    const others = ["other-source", "other-stable-group"].map((id, i) => ({ ...f.before, id, encryptedSecret: "other-key", config: {
      ...f.before.config, usage: "canvas", ...(i ? { accountKeyGroupId: "20" } : { supplierSourceId: "other-source" }) } }));
    const result = plan(f, [f.after, ...others]);
    expect(result.addedIds).toHaveLength(1);
    expect(result.connections.slice(1, 3)).toEqual(others);
  });
  it("matches named NewAPI groups only when neither account nor catalog supplies a stable number", () => {
    const f = fixture();
    delete f.before.config.accountKeyGroupId; delete f.after.config.accountKeyGroupId;
    delete f.account.keys[0]!.supplierGroupId; delete f.supplier.catalog.groups[0]!.supplierGroupId;
    expect(plan(f).addedIds).toHaveLength(1);
    f.account.keys[0]!.group = "another-group";
    expect(plan(f).addedIds).toEqual([]);
  });
  it("requires an exact connected submit/output contract for declared video rather than a video ID", () => {
    const f = fixture();
    const video = { ...structuredClone(image), id: "exact-video", operations: ["video.generate"], outputKinds: ["video"],
      metadata: { outputKindsSource: "declared", autoInterfaceStatus: "connected", canvasRunnable: true } } as ModelDescriptor;
    f.after.config.scannedModelIds = [video.id];
    f.after.config.modelCatalogModels = [video] as unknown as typeof f.after.config.modelCatalogModels;
    expect(plan(f).addedIds).toEqual([]);
    f.after.config.autoModelInterfaces = { [video.id]: { model: video, sourceUrl: "https://supplier.example.test/docs", connector: {
      submit: { method: "POST", path: "/videos", bodyMode: "json", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] },
      output: { kind: "video", urlPath: "$.url" },
    } } } as unknown as typeof f.after.config.autoModelInterfaces;
    const result = plan(f);
    expect(result.addedIds).toHaveLength(1);
    expect(result.connections[1]!.config.autoModelInterfaces).toEqual(f.after.config.autoModelInterfaces);
    (f.after.config.autoModelInterfaces as unknown as Record<string, { model: ModelDescriptor }>)[video.id]!.model = { ...video, id: "sibling-video" };
    expect(plan(f).addedIds).toEqual([]);
  });
});
