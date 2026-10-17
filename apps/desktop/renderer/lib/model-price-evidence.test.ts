import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPriceEvidenceRows } from "./model-price-evidence";

const sampled = "2026-10-10T08:00:00Z", fresh = "2026-10-17T08:00:00Z";
describe("price evidence presentation", () => {
  it("shows each conditional price's actual sample and source without overwriting old provenance", () => {
    const model: ModelDescriptor = { id: "exact-full-image-id", name: "Image", operations: ["image.generate"], pricing: {
      kind: "per-image", billingUnit: "image", currency: "CNY", confidence: "exact", checkedAt: fresh, tiers: [
        { id: "2k", label: "2K", dimension: "resolution", value: "2K", price: 0.5,
          evidence: { sourceKey: "price-source", checkedAt: sampled, sourceUrl: "https://fixture.invalid/pricing?token=never-expose", status: "retained" } },
        { id: "4k", label: "4K", dimension: "resolution", value: "4K", price: 1,
          evidence: { sourceKey: "price-source", checkedAt: fresh, sourceUrl: "https://fixture.invalid/pricing", status: "published" } },
      ],
    } };
    const rows = modelPriceEvidenceRows(model);
    expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ label: "上次价格", checkedAt: sampled, sourceUrl: "https://fixture.invalid/pricing" });
    expect(rows[0]?.amount).toContain("0.5"); expect(rows[0]?.amount).toContain("2K");
    expect(rows[1]).toMatchObject({ label: "公布价", checkedAt: fresh });
    expect(JSON.stringify(rows)).not.toContain("never-expose");
  });
  it("shows current published tariff and original charge side by side, never including raw prompts or references", () => {
    const model: ModelDescriptor = { id: "exact-full-id", name: "Image", operations: ["image.generate"], pricing: {
      kind: "per-image", billingUnit: "image", currency: "CNY", unitAmount: 0.5, confidence: "exact", checkedAt: fresh,
    }, metadata: { measuredPrice: { parameterScope: "exact", requestId: "request-a", checkedAt: sampled, amount: 0.4, currency: "CNY", unit: "image",
      actualCharge: { amount: 0.4, currency: "CNY", unit: "image", requestId: "request-a" }, parameters: {
        quality: "high", resolution: "4K", prompt: "never-expose", reference_images: ["https://fixture.invalid/private.png"],
      } } } };
    const rows = modelPriceEvidenceRows(model);
    expect(rows.map(row => row.kind)).toEqual(["published", "measured"]);
    expect(rows[1]).toMatchObject({ label: "账单实测 · 仅对应请求", amount: "0.4 CNY / 张", checkedAt: sampled });
    expect(rows[1]?.scope).toContain("reference_images 数量=1");
    expect(JSON.stringify(rows)).not.toMatch(/never-expose|private\.png/u);
    expect(model.pricing?.unitAmount).toBe(0.5);
  });
  it("preserves explicitly unpublished old prices as view-only history after three cycles", () => {
    const model: ModelDescriptor = { id: "full-id", name: "Image", operations: [], metadata: { catalogPriceEvidence: { schemaVersion: 1,
      status: "explicit-unpublished", entries: [{ sourceKey: "source", modelId: "full-id", conditionKey: "opaque", status: "explicit-unpublished",
        unpublishedCycles: 3, lastDispatchSeq: 3, checkedAt: fresh, history: [{ label: "0.5 CNY / 张 · 4K", checkedAt: sampled }] }] } } };
    expect(modelPriceEvidenceRows(model)).toEqual([{ kind: "published", label: "价格不再公布", amount: "—", checkedAt: fresh, sourceUrl: undefined },
      { kind: "historical", label: "历史公布价", amount: "0.5 CNY / 张 · 4K", checkedAt: sampled, sourceUrl: undefined }]);
    expect(modelPriceEvidenceRows(null)).toEqual([]);
  });
  it("never guesses the unit of an unscoped legacy charge", () => {
    const rows = modelPriceEvidenceRows({ id: "legacy", name: "Legacy", operations: [], metadata: { measuredPrice: { amount: 2 } } });
    expect(rows[0]).toMatchObject({ label: "历史扣费记录 · 仅原范围", amount: "2 账户计价单位", scope: "原请求参数未记录" });
  });
  it("does not attribute protected manual rates to a supplier publication", () => {
    const model: ModelDescriptor = { id: "manual", name: "Manual", operations: [], pricing: { kind: "per-request", currency: "CNY", unitAmount: 2,
      billingUnit: "request", checkedAt: sampled, confidence: "exact" }, metadata: { priceSource: "manual" } };
    expect(modelPriceEvidenceRows(model)[0]?.label).toBe("人工保存报价");
    expect(modelPriceEvidenceRows({ ...model, metadata: { customBilling: true } })[0]?.label).toBe("自定义计费");
  });
});
