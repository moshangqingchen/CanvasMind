import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(async () => null) }));
vi.mock("./supplier-site-session", () => ({ openSupplierSiteSession: vi.fn(async () => undefined), supplierSiteLoginCacheIdentity: vi.fn(() => null) }));
import { applyTk1688CatalogModel, mergeTk1688ModelInventory, tk1688InventoryDefaultModel } from "./tk1688-catalog";

const base = "gpt-image-2.5-sunburst";
const model: ModelDescriptor = { id: base, name: base, provider: "openai", operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true } };
const sku = (alias: string, description: string, extra = {}) => ({ base_model: base, alias, description, charge_type: "per_request", input_price_usd: 0.03,
  status: "active", channel_alive: true, ...extra });
const market = (...items: unknown[]) => ({ success: true, data: { items, total: items.length } });

describe("词元 inventory permission join", () => {
  it("syncs the new text merchants only through the current Key, account and online market intersection", () => {
    const families = ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5"];
    const products = [
      ...["grok-4.5", "grok-4.6", "grok-4.7"].map(base_model => ({ base_model, alias: `${base_model}@s1c359` })),
      ...["s1c360", "s1c361"].flatMap(channel => families.map(base_model => ({ base_model, alias: `${base_model}@${channel}` }))),
    ].map(row => ({ ...row, charge_type: "per_token", status: "active", channel_alive: true,
      input_price_usd: 0.104506, output_price_usd: 0.52253 }));
    const keys: ModelDescriptor[] = [...families, "grok-4.5", "grok-4.6", "grok-4.7", "gpt-5.4"].map(id => ({
      id, name: id, provider: "openai", operations: [], inputKinds: ["text"], outputKinds: ["text"],
    }));
    const allAliases = products.map(product => product.alias);
    const status = { success: true, data: { payment_fx_rate_cny_per_usd: 6.8896, platform_markup_percent: 20 } };
    const merged = mergeTk1688ModelInventory(keys, market(...products), status, { accountModelIds: allAliases });
    expect(merged.filter(model => /@s1c(?:359|360|361)$/u.test(model.id))).toHaveLength(15);
    expect(merged.find(model => model.id === "gpt-5.4")?.outputKinds).toEqual(["text"]);
    expect(merged.find(model => model.id === "gpt-6.1-sol@s1c361")?.pricing).toMatchObject({
      kind: "token", currency: "CNY", inputPerMillion: 0.7200045376,
    });
    const narrowed = mergeTk1688ModelInventory(keys.filter(model => model.id !== "grok-4.7"),
      market(...products.map(product => product.alias === "gpt-5.5@s1c360" ? { ...product, channel_alive: false } : product)),
      status, { accountModelIds: allAliases.filter(id => id !== "gpt-6-astra@s1c361") });
    expect(narrowed.filter(model => /@s1c(?:359|360|361)$/u.test(model.id))).toHaveLength(12);
    expect(narrowed.map(model => model.id)).not.toContain("grok-4.7@s1c359");
    expect(narrowed.map(model => model.id)).not.toContain("gpt-5.5@s1c360");
    expect(narrowed.map(model => model.id)).not.toContain("gpt-6-astra@s1c361");
    expect(mergeTk1688ModelInventory(keys, market(...products), status).some(model => model.id.includes("@"))).toBe(false);
  });
  it("retains an agent's live text default despite the directory marking it unavailable on the canvas", () => {
    const text: ModelDescriptor = { id: "gpt-6.1-sol", name: "GPT", operations: [], outputKinds: ["text"],
      metadata: { canvasRunnable: false, outputKindsSource: "declared" } };
    const agent = { provider: "rest", config: { usage: "agent" } };
    expect(tk1688InventoryDefaultModel(agent, [model, text], text.id)?.id).toBe(text.id);
    const merchant = { ...text, id: "gpt-6.1-sol@s1c66" };
    expect(tk1688InventoryDefaultModel(agent, [model, text, merchant], merchant.id)?.id).toBe(merchant.id);
    expect(tk1688InventoryDefaultModel(agent, [model, text], "removed-text-model")?.id).toBe(text.id);
    expect(tk1688InventoryDefaultModel(agent, [model], "removed-text-model")).toBeUndefined();
  });
  it("keeps canvas defaults among generation models while ignoring text-only entries", () => {
    const text: ModelDescriptor = { id: "gpt-6.1-sol", name: "GPT", operations: [], outputKinds: ["text"], metadata: { canvasRunnable: false } };
    const merchant = { ...model, id: `${base}@s47c261` };
    const canvas = { provider: "openai", config: { usage: "canvas" } };
    expect(tk1688InventoryDefaultModel(canvas, [text, model, merchant], merchant.id)?.id).toBe(merchant.id);
    expect(tk1688InventoryDefaultModel(canvas, [text, model], text.id)?.id).toBe(model.id);
  });
  it("adds only the Key family's account-visible live merchants and retains bare smart routing", () => {
    const merged = mergeTk1688ModelInventory([model], market(sku(`${base}@s47c261`, "Adobe原生4K(3840*2160)，不支持N。"),
      sku(`${base}@s46c264`, "1K/2K"), sku(`${base}@s1c23`, "1K")), undefined,
    { accountModelIds: [`${base}@s47c261`, `${base}@s46c264`] });
    expect(merged.map(model => model.id)).toEqual([base, `${base}@s47c261`, `${base}@s46c264`]);
    expect(merged[0]?.metadata?.tk1688SupportedResolutions).toEqual([]);
    expect(merged[1]?.metadata).toMatchObject({ tk1688FixedSize: "3840x2160", fixedOutputCount: 1, tk1688OmitN: true });
    expect(mergeTk1688ModelInventory([model], market(sku(`${base}@s47c261`, "4K")), undefined).map(model => model.id)).toEqual([base]);
  });
  it("preserves previous exact-SKU facts on failure while removing models outside a changed Key inventory", () => {
    const saved = mergeTk1688ModelInventory([model], market(sku(`${base}@s47c261`, "Adobe原生4K(3840*2160)，不支持N。")), undefined,
      { accountModelIds: [`${base}@s47c261`] });
    const stale = mergeTk1688ModelInventory([model], undefined, undefined, { savedModels: saved });
    expect(stale.map(model => model.id)).toEqual([base, `${base}@s47c261`]);
    expect(stale.every(model => model.metadata?.tk1688CatalogStale === true)).toBe(true);
    const replacement = { ...model, id: "other-image", name: "other-image" };
    expect(mergeTk1688ModelInventory([replacement], undefined, undefined, { savedModels: saved }).map(model => model.id)).toEqual(["other-image"]);
  });
  it("does not keep explicitly offline channels from a broad authenticated inventory", () => {
    const alias = `${base}@s47c261`;
    expect(mergeTk1688ModelInventory([{ ...model, id: alias }], market(sku(alias, "4K", { channel_alive: false })), undefined,
      { accountModelIds: [alias] })).toEqual([]);
  });
  it("refreshes owned noN/fixed-pixel metadata and leaves unrelated model IDs intact", () => {
    const prior = { ...model, id: `${base}@s1c23`, limits: { maxOutputImages: 1 }, metadata: {
      canvasRunnable: true, tk1688Catalog: true, tk1688OmitN: true, tk1688FixedSize: "3840x2160", fixedOutputCount: 1 } };
    const next = applyTk1688CatalogModel(prior, { id: prior.id, metadata: { tk1688Catalog: true, tk1688Parameters: [], tk1688SupportedResolutions: ["1K"] } }, "now");
    expect(next.metadata?.tk1688OmitN).toBeUndefined();
    expect(next.metadata?.tk1688FixedSize).toBeUndefined();
    expect(next.metadata?.fixedOutputCount).toBeUndefined();
    expect(next.limits?.maxOutputImages).toBeUndefined();
    expect(applyTk1688CatalogModel(model, { id: "unrelated", metadata: { tk1688Catalog: true } }, "now")).toBe(model);
  });
});
