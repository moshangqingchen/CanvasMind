import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StructuredModelPricing } from "./contracts.js";
import { chuangxiangCatalogPricing } from "./chuangxiang-catalog-pricing.js";
import { chuangxiangVideoModel, isChuangxiangVideoConnection } from "./chuangxiang-video-contract.js";
import { parseHangChatPrices } from "./hang-catalog-pricing.js";
import { modelPriceAmount } from "./media-billing.js";
import { parseSupplierCatalog, parseSupplierKeyGroups } from "./supplier-catalog.js";
import { parseSupplierGroupDetails, supplierGroupPriceLabel } from "./supplier-group-details.js";

type Row = Record<string, unknown>;
type Change = { supplier: string; officialGroupId: string | null; group: string; fullModelId: string | null; type: string; before: unknown; after: unknown };
type Snapshot = {
  changes: Change[];
  videoPriceChanges: { fullModelId: string; rawAfter: { billing_mode: string } | null; CnyAfter: Record<string, number> | null }[];
  chuangxiangPlaza: { data: { groups: (Row & { id: number; models: Row[] })[] } };
  chuangxiangGroups: unknown; synoraGroups: unknown; hangGroups: unknown; hangPrices: unknown;
  keys: { supplier: string; officialGroupId: string | null; group: string; httpStatus: number; baselineModels: string[]; currentModels: string[] }[];
};
const snapshot = JSON.parse(readFileSync(new URL("./fixtures/supplier-c-20261014.json", import.meta.url), "utf8")) as Snapshot;
const checkedAt = "2026-10-14T23:27:38.775Z", site = "https://vapi.chuangxiangai.asia";
const catalog = parseSupplierCatalog(snapshot.chuangxiangPlaza, { supplierSiteUrl: site, checkedAt });
const rawVideo = snapshot.chuangxiangPlaza.data.groups.find(group => group.id === 27)!.models;
const noNetwork = vi.fn(() => { throw new Error("Supplier C regression must never send a real request"); });
beforeEach(() => { noNetwork.mockClear(); vi.stubGlobal("fetch", noNetwork); });
afterEach(() => { try { expect(noNetwork).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

describe("October 14 supplier C source contracts", () => {
  it.each(snapshot.videoPriceChanges)("keeps Chuangxiang 27/$fullModelId current resolution prices and native billing unit", row => {
    const model = catalog.groups.find(group => group.supplierGroupId === "27")!.models.find(model => model.id === row.fullModelId);
    if (!row.rawAfter) { expect(model).toBeUndefined(); return; }
    expect(model?.capability).toBe("video");
    const pricing = model?.metadata?.chuangxiangCatalogPricing as StructuredModelPricing;
    expect(pricing).toMatchObject({ currency: "CNY", checkedAt, billingUnit: row.rawAfter.billing_mode === "per_second" ? "second" : "request" });
    for (const [resolution, expected] of Object.entries(row.CnyAfter!)) {
      expect(modelPriceAmount(pricing, { resolution, duration: 30 })).toBe(expected);
      expect(modelPriceAmount(pricing, { resolution, duration: 5 })).toBe(expected);
    }
    expect(modelPriceAmount(pricing, { resolution: "unpublished" })).toBeUndefined();
  });

  const addedChat = snapshot.changes.filter(row => row.supplier === "chuangxiang" && ["56", "57", "59"].includes(row.officialGroupId ?? "") && row.fullModelId);
  it.each(addedChat)("keeps new/first-observed chat identity $officialGroupId/$fullModelId and exact effective multiplier", row => {
    const model = catalog.groups.find(group => group.supplierGroupId === row.officialGroupId)!.models.find(model => model.id === row.fullModelId)!;
    expect(model.capability).toBe("chat");
    expect(model.outputKinds ?? []).not.toContain("image");
    const raw = snapshot.chuangxiangPlaza.data.groups.find(group => String(group.id) === row.officialGroupId)!.models.find(model => model.name === row.fullModelId)!;
    const pricing = model.metadata?.chuangxiangCatalogPricing as StructuredModelPricing;
    const rates = raw.pricing as Row;
    const ordinary = new Date("2026-10-14T05:00:00Z"), peak = new Date("2026-10-14T02:00:00Z");
    for (const [kind, field] of [["input", "input_price"], ["output", "output_price"], ["cache_read", "cache_read_price"]]) {
      if (typeof rates[field!] !== "number") continue;
      const expected = Number(((rates[field!] as number) * 1e6 * (raw.effective_rate_multiplier as number)).toPrecision(12));
      expect(modelPriceAmount(pricing, { token_kind: kind }, ordinary)).toBe(expected);
      expect(modelPriceAmount(pricing, { token_kind: kind }, peak)).toBe(Number((expected * (row.officialGroupId === "57" ? 2 : 1)).toPrecision(12)));
    }
  });

  it.each(snapshot.changes.filter(row => row.supplier === "chuangxiang" && row.fullModelId && row.type === "官网当前目录不再列出"))(
    "removes $officialGroupId/$fullModelId only from the current supplier catalogue", row => {
      expect(catalog.groups.find(group => group.supplierGroupId === row.officialGroupId)?.models.some(model => model.id === row.fullModelId)).toBe(false);
      if (row.officialGroupId === "27") {
        // The historical contract is deliberately retained so existing tasks
        // can still poll their original endpoint; a catalogue is not history.
        expect(chuangxiangVideoModel(row.fullModelId!).outputKinds).toEqual(["video"]);
      }
    });

  it("binds new SD8 S to current group 27 and keeps its fixed 30s/720p/30-image/10-video/10-audio contract", () => {
    const raw = rawVideo.find(row => row.name === "sd8-seedance-2.5-s")!;
    const priced = chuangxiangCatalogPricing(raw, checkedAt)!;
    const model = chuangxiangVideoModel(String(raw.name), { id: String(raw.name), name: String(raw.name), operations: [], pricing: priced.pricing });
    expect(modelPriceAmount(model.pricing!, { resolution: "720p", duration: 30 })).toBe(10.48);
    expect(model.limits).toMatchObject({ maxInputImages: 30, maxInputVideos: 10, maxInputAudios: 10 });
    expect(model.metadata).toMatchObject({ videoMinDuration: 30, videoMaxDuration: 30, videoSupportedResolutions: ["720p"], videoSupportsFirstLastFrames: false });
    expect(isChuangxiangVideoConnection({ baseUrl: site, accountKeyGroupId: "27", accountKeyGroup: "renamed" }, model.id)).toBe(true);
    expect(isChuangxiangVideoConnection({ baseUrl: site, accountKeyGroupId: "28", accountKeyGroup: "视频" }, model.id)).toBe(false);
  });

  it.each([[56, .2], [57, .15], [58, .12], [59, .25]])("decodes Chuangxiang stable group %s's declared ten-unit rate once", (id, multiplier) => {
    const groups = parseSupplierKeyGroups(snapshot.chuangxiangGroups, "sub2api", { supplierSiteUrl: site })!;
    expect(groups.find(group => group.supplierGroupId === String(id))?.details?.rateMultiplier).toBe(multiplier);
    const plaza = catalog.groups.find(group => group.supplierGroupId === String(id));
    if (plaza) expect(plaza.details?.rateMultiplier).toBe(multiplier);
    if (id === 58) expect(groups.find(group => group.supplierGroupId === "58")?.models).toEqual([]);
  });

  it.each(snapshot.changes.filter(row => row.supplier === "synora"))(
    "preserves Synora group $officialGroupId's current name, description and multiplier without manufacturing models", row => {
      const groups = parseSupplierKeyGroups(snapshot.synoraGroups, "sub2api")!;
      const group = groups.find(group => group.supplierGroupId === row.officialGroupId);
      if (!row.after) { expect(group).toBeUndefined(); return; }
      expect(group?.id).toBe(row.group);
      const after = row.after as Row;
      if (typeof after.description === "string") expect(group?.details?.description).toBe(after.description);
      if (typeof after.rate_multiplier === "number") expect(group?.details?.rateMultiplier).toBe(after.rate_multiplier);
      expect(group?.models).toEqual([]);
      if (row.officialGroupId === "99") expect(supplierGroupPriceLabel(group?.details)).toBe("0.04/张（分组说明参考）");
      if (row.officialGroupId === "125") expect(group?.details?.referencePrice).toBe("2 006/张；2.5 008/张");
    });

  it.each(snapshot.changes.filter(row => row.supplier === "hang" && row.fullModelId))(
    "reads Hang $officialGroupId/$fullModelId as token evidence with the published multiplier already applied", row => {
      const parsed = parseHangChatPrices(snapshot.hangPrices, "https://api.hangzhale.com", checkedAt);
      const current = parsed.rows.find(item => item.modelId === row.fullModelId && item.group === row.group);
      if (!row.after) { expect(current).toBeUndefined(); return; }
      expect(current?.pricing).toMatchObject({ kind: "token", currency: "CNY" });
      const after = row.after as Row;
      for (const [kind, field] of [["input", "input_price"], ["output", "output_price"], ["cache_read", "cache_input_price"]])
        expect(modelPriceAmount(current!.pricing, { token_kind: kind })).toBe(after[field!]);
    });

  it("keeps Hang 104 and Synora 125 public group declarations separate from uncreated Key permissions", () => {
    const groups = parseSupplierKeyGroups(snapshot.hangGroups, "sub2api")!;
    expect(groups.find(group => group.supplierGroupId === "104")).toMatchObject({ models: [], details: { rateMultiplier: .35 } });
    expect(snapshot.keys.some(key => key.supplier === "hang" && key.officialGroupId === "104")).toBe(false);
    expect(snapshot.keys.some(key => key.supplier === "synora" && key.officialGroupId === "125")).toBe(false);
  });

  it("does not manufacture Monster alias removal or Genimage deletion from an empty current response", () => {
    const monster = snapshot.keys.find(key => key.supplier === "monster" && key.officialGroupId === "11")!;
    expect(monster.currentModels).toEqual(monster.baselineModels);
    expect(monster.currentModels).toContain("gemini-nano-banana-2.1");
    expect(monster.currentModels).not.toContain("nano-banana-2.1");
    const empty = snapshot.keys.find(key => key.supplier === "genimage" && key.currentModels.length === 0)!;
    expect(empty.httpStatus).toBe(200);
    expect(empty.baselineModels).toEqual([]);
    expect(snapshot.keys.filter(key => key.supplier === "zhiyuan").every(key => JSON.stringify(key.baselineModels) === JSON.stringify(key.currentModels))).toBe(true);
  });

  it("uses only an explicit positive group rate scale and keeps unscaled suppliers unchanged", () => {
    expect(parseSupplierGroupDetails({ rate_multiplier: 1.5, rate_multiplier_unit_scale: 10, image_rate_independent: true, image_rate_multiplier: 2 }, "model-plaza"))
      .toMatchObject({ rateMultiplier: .15, imageRateMultiplier: .2 });
    expect(parseSupplierGroupDetails({ rate_multiplier: .35 }, "key-groups")?.rateMultiplier).toBe(.35);
    for (const scale of [0, -1, "10", null, Infinity]) expect(parseSupplierGroupDetails({ rate_multiplier: 1.5, rate_multiplier_unit_scale: scale }, "model-plaza")?.rateMultiplier).toBeUndefined();
  });
});
