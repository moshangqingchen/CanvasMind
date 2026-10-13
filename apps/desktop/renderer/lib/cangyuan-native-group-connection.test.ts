import { describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { GenericRestAdapter, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";
import { canApplyCangyuanCurrentContract } from "@super-canvas/providers/cangyuan-current-models";
import { reconcileCangyuanNativeGroupConnection } from "./cangyuan-native-group-connection";
import { planSupplierAccountImport } from "./supplier-account-import";
import { supplierConnectionDraft } from "./supplier-connection-draft";
import { bindScannedModelProtocols } from "./scanned-model-protocols";

const ids = ["gpt-image-2-az", "gpt-image-2.5-flare-az", "gpt-image-2.5-sunburst-az"];
const group = { id: "IMAGE-GPT-Azure", label: "Azure", source: "catalog" as const,
  models: ids.map(id => ({ id, name: id, capability: "image" as const })) };
const supplier = { id: "cang", supplierKey: "cangyuan", name: "沧元算力", siteUrl: "https://ai.cangyuansuanli.cn",
  apiUrl: "https://ai.cangyuansuanli.cn", catalog: { groups: [group] }, state: { sourceId: "current-source" } } as unknown as SupplierRecord;
function previous(): ProviderConnectionRecord {
  return { id: "saved-azure", name: "User kept name", provider: "openai", encryptedSecret: "encrypted-offline",
    createdAt: "old-created", updatedAt: "old-updated", config: { supplierId: supplier.id, supplierKey: "cangyuan", supplierSourceId: "current-source",
      baseUrl: supplier.apiUrl, usage: "canvas", modelGroup: group.id, accountKeyGroup: group.id, accountKeyId: "7953", accountKeyImportedAt: "before",
      customGroup: true, defaultModel: ids[2], scannedModelIds: ids, modelScanStatus: "live", modelScanComplete: true,
      autoModelInterfaces: Object.fromEntries(ids.map(id => [id, { source: "auto", model: { id, name: id, operations: ["image.generate"] } }])) } };
}
const scan: ModelDescriptor[] = ids.map(id => ({ id, name: id, operations: ["image.generate", "image.edit"], metadata: { parameterSource: "key-model-scan" } }));

describe("current Cangyuan Azure native group import", () => {
  it("creates only the three exact Azure models with native asynchronous REST transport", () => {
    const draft = supplierConnectionDraft("cangyuan", group, "canvas", supplier.apiUrl);
    expect(draft.provider).toBe("rest");
    expect(draft.config).toMatchObject({ modelGroup: group.id, defaultModel: ids[0], customGroup: false });
    expect((draft.config.connector as { models: ModelDescriptor[] }).models.map(m => m.id)).toEqual(ids);
    expect(supplierConnectionDraft("cangyuan", { ...group, source: "manual" }, "canvas", supplier.apiUrl).provider).toBe("openai");
  });
  it("keeps connection, credential, selected model and history identity while repairing the proven import once", () => {
    const saved = previous();
    const inventory = { keys: [{ id: "7953", group: group.id, name: "offline", apiKey: "offline" }], complete: true, skipped: 0, checkedAt: "now" };
    const options = { verifyCapabilities: false, preserveOnly: true, matchesKey: (c: ProviderConnectionRecord) => c.encryptedSecret === "encrypted-offline" };
    // Unnumbered exact same Key can authorize this transport repair without
    // treating unrelated renamed groups as a stable identity.
    const direct = reconcileCangyuanNativeGroupConnection(saved);
    expect(direct).toMatchObject({ ...saved, provider: "rest", config: { ...saved.config, customGroup: false, autoModelInterfaces: {} } });
    expect(reconcileCangyuanNativeGroupConnection(direct)).toBe(direct);
    const plan = planSupplierAccountImport(supplier, [saved], inventory, () => { throw Error("Must not encrypt/replace"); }, [saved], options);
    expect(plan.connections).toEqual([direct]);
    expect(plan.summary).toMatchObject({ imported: 0, preserved: 1 });
    expect(planSupplierAccountImport(supplier, plan.connections, inventory, () => { throw Error("Must not replace"); }, plan.connections, options).connections).toEqual(plan.connections);
  });
  it("leaves explicit manual/custom protocols, foreign source, agent and denied scope untouched", () => {
    const saved = previous();
    for (const patch of [ { manualProtocol: true }, { autoProtocol: false }, { connector: { custom: true } }, { preset: "user" },
      { protocol: "user" }, { modelInterfaces: {} }, { manualModels: [{ id: ids[0] }] }, { usage: "agent" }, { usage: "disabled" },
      { supplierArchived: true }, { accountKeyGroup: "IMAGE" }, { modelGroup: "IMAGE" }, { accountKeyImportedAt: null },
      { modelScanStatus: "unauthorized" }, { modelScanStatus: "empty" }, { scannedModelIds: ["foreign-id"] },
      { baseUrl: "https://foreign.example" }, { supplierKey: "other" } ]) {
      const custom = { ...saved, config: { ...saved.config, ...patch } } as ProviderConnectionRecord;
      expect(reconcileCangyuanNativeGroupConnection(custom)).toBe(custom);
    }
  });
  it.each(ids)("keeps highest 4K parameters through native JSON submission and exact operation polling for %s", async id => {
    const migrated = reconcileCangyuanNativeGroupConnection(previous()), bound = bindScannedModelProtocols(migrated, scan);
    const config = { ...migrated.config, connector: bound.connector };
    const model = bound.models.find(m => m.id === id)!;
    expect(canApplyCangyuanCurrentContract(config, supplier.apiUrl, id)).toBe(true);
    expect(model.parameters?.find(p => p.key === "size")?.allowCustomValue).toBe(true);
    const quality = id === ids[0] ? "high" : "max";
    expect(model.parameters?.find(p => p.key === "quality")?.options?.some(o => o.value === quality)).toBe(true);
    for (const operation of ["image.generate", "image.edit"] as const) {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "original-task", status: "running" }));
      const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: migrated.id, provider: "rest", baseUrl: supplier.apiUrl,
        apiKey: "offline-test", settings: config }]), { fetch: fetcher });
      const parameters = { size: "3840x2160", quality, output_format: "png", n: 1, response_format: "url", async: true };
      const task = await adapter.submit({ connectionId: migrated.id, model: id, operation, idempotencyKey: "offline-once", prompt: "offline native contract regression", parameters,
        ...(operation === "image.edit" ? { assets: [{ id: "original-reference", kind: "image", mimeType: "image/png", url: "https://images.example/original.png" }] } : {}) });
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(body).toMatchObject({ model: id, ...parameters });
      const path = operation === "image.edit" ? "/v1/images/edits" : "/v1/images/generations";
      expect(String(fetcher.mock.calls[0]![0])).toBe(supplier.apiUrl + path);
      expect(fetcher.mock.calls[0]![1]!.headers).toBeTruthy();
      if (operation === "image.edit") expect(body.images).toEqual(["https://images.example/original.png"]);
      await adapter.poll(task);
      expect(String(fetcher.mock.calls[1]![0])).toBe(supplier.apiUrl + path + "/original-task");
    }
  });
});
