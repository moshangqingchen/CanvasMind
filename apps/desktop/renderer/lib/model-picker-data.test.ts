import { expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPickerPriceCompact, modelPickerPriceData, modelPickerPriceSampleAt } from "./model-picker-data";

it("shows Chuangxiang weekday peak pricing without implying a weekend multiplier", () => {
  const label = modelPickerPriceData({ id: "deepseek-v4-pro", name: "deepseek-v4-pro", operations: [], pricing: {
    kind: "token", currency: "USD", inputPerMillion: 1, outputPerMillion: 2,
    checkedAt: "2026-10-14T23:27:38Z", confidence: "exact",
    timeMultipliers: [{ timeZone: "Asia/Shanghai", startHour: 9, endHour: 12, multiplier: 2, weekdaysOnly: true }],
  } });
  expect(label).toContain("周一至周五 9:00–12:00 ×2");
  expect(label).toContain("上海");
});

const compactModel = (values: Partial<ModelDescriptor>): ModelDescriptor => ({ id: "isolated-image", name: "隔离模型", operations: [], ...values });

it("keeps the measured source and tier while removing only the request evidence tail", () => {
  const model = compactModel({ metadata: { priceSource: "generated-result", priceLabel: "$0.08/张（账单实测）· 4K",
    measuredPrice: { parameters: { n: 1, resolution: "4K", quality: "max" } } } });
  const detail = modelPickerPriceData(model);
  expect(detail).toContain(" · 实测参数：数量=1，分辨率=4K，质量=max");
  expect(modelPickerPriceCompact(model)).toBe("$0.08/张（账单实测）· 4K");
  expect(modelPickerPriceData(model)).toBe(detail);
  expect(modelPickerPriceCompact(compactModel({ metadata: { ...model.metadata,
    measuredPrice: { parameters: {} }, priceStatus: "partial" } }))).toBe("上次记录 · $0.08/张（账单实测）· 4K");
});

it("summarizes a structured unit price with its currency and billing unit", () => {
  const model = compactModel({ pricing: { kind: "per-image", currency: "USD", unitAmount: 0.08,
    checkedAt: "2026-10-16T00:00:00Z", confidence: "exact" } });
  expect(modelPickerPriceCompact(model)).toBe("0.08 USD / 张");
  expect(modelPickerPriceCompact({ ...model, metadata: { priceSource: "generated-result", measuredPrice: { parameters: {} } } }))
    .toBe("0.08 USD / 张");
  expect(modelPickerPriceCompact(compactModel({ pricing: { kind: "per-second", currency: "CNY", unitAmount: 0.2,
    checkedAt: "2026-10-16T00:00:00Z", confidence: "estimate" }, metadata: { billingIncludesInputDuration: true } })))
    .toBe("0.2 CNY / 秒（参考） · 输入+输出时长");
});

it("shows the complete tariff range and count rather than selecting a starting tier", () => {
  expect(modelPickerPriceCompact(compactModel({ pricing: { kind: "per-image", currency: "USD",
    checkedAt: "2026-10-16T00:00:00Z", confidence: "exact",
    tiers: [0.02, 0.04, 0.08].map((price, index) => ({ id: `tier-${index}`, dimension: "resolution", value: `${index + 1}K`, label: `${index + 1}K`, price })),
    timeMultipliers: [{ timeZone: "Asia/Shanghai", startHour: 9, endHour: 12, multiplier: 2 }],
  } }))).toBe("0.02–0.08 USD / 张 · 3 档 · 时段倍率");
  expect(modelPickerPriceCompact(compactModel({ pricing: { kind: "per-image", currency: "USD",
    checkedAt: "2026-10-16T00:00:00Z", confidence: "exact",
    tiers: [{ id: "4k", dimension: "resolution", value: "4K", label: "4K", price: 0.08 }],
  } }))).toBe("0.08 USD / 张 · 分辨率=4K");
});

it("keeps token billing short and preserves missing quotes", () => {
  expect(modelPickerPriceCompact(compactModel({ pricing: { kind: "token", currency: "USD", inputPerMillion: 1,
    outputPerMillion: 2, checkedAt: "2026-10-16T00:00:00Z", confidence: "exact" } }))).toBe("Token 计价");
  for (const model of [undefined, null, compactModel({}), compactModel({ metadata: { priceLabel: "未确认" } })])
    expect(modelPickerPriceCompact(model)).toBe("—");
});

it("shows retained directory prices with the original sample time in detailed and compact labels", () => {
  const oldTime = "2026-10-10T03:04:05.000Z";
  const model = compactModel({ pricing: { kind: "tiered", billingUnit: "request", currency: "CNY", checkedAt: oldTime, confidence: "exact",
    tiers: [{ id: "4k", dimension: "resolution", value: "4K", label: "4K", price: 0.8, conditionMode: "all", conditions: [
      { parameter: "resolution", operator: "equals", value: "4K" }, { parameter: "quality", operator: "equals", value: "max" },
    ] }] }, metadata: { priceStatus: "partial", priceLabel: "0.8 CNY / 次（上次价格）", priceCheckedAt: oldTime,
    priceLastAttemptAt: "2026-10-17T08:00:00.000Z" } });
  const before = JSON.stringify(model);
  for (const label of [modelPickerPriceData(model), modelPickerPriceCompact(model)]) {
    expect(label).toContain(`上次价格 · 采样时间 ${oldTime} · `);
    expect(label).toContain("分辨率=4K 且 质量=max");
    expect(label).not.toContain("2026-10-17");
    expect(label.match(/上次价格/gu)).toHaveLength(1);
  }
  expect(JSON.stringify(model)).toBe(before);
});

it("recognizes the legacy suffix on a prose group quote and keeps its own sample", () => {
  const model = compactModel({ metadata: { priceLabel: "0.08一张，原生2K/4K（上次价格）", supplierCatalogPriceCheckedAt: "2026-10-09T02:00:00Z" } });
  expect(modelPickerPriceData(model)).toBe("上次价格 · 采样时间 2026-10-09T02:00:00Z · 0.08一张，原生2K/4K");
  expect(modelPickerPriceCompact(model)).toBe(modelPickerPriceData(model));
});

it("does not turn a missing quote or a directory attempt time into a price sample", () => {
  const missing = compactModel({ metadata: { priceStatus: "partial", priceCheckedAt: "2026-10-10T03:04:05.000Z", priceLabel: "价格未公布" } });
  expect(modelPickerPriceData(missing)).toBe("—");
  expect(modelPickerPriceCompact(missing)).toBe("—");
  const unsampled = compactModel({ metadata: { priceStatus: "partial", priceLabel: "0.08一张", priceCheckedAt: "invalid",
    priceLastAttemptAt: "2026-10-17T08:00:00Z" } });
  expect(modelPickerPriceSampleAt(unsampled)).toBeUndefined();
  expect(modelPickerPriceData(unsampled)).toBe("上次价格 · 采样时间 — · 0.08一张");
  expect(modelPickerPriceSampleAt(compactModel({ pricing: { kind: "per-image", currency: "USD", unitAmount: 0.1,
    checkedAt: "2026-10-09T02:00:00Z", confidence: "exact" }, metadata: { priceCheckedAt: "2026-10-10T03:04:05.000Z" } })))
    .toBe("2026-10-10T03:04:05.000Z");
});

it("keeps measured evidence distinct from a retained directory tariff", () => {
  const model = compactModel({ metadata: { priceSource: "generated-result", priceCheckedAt: "2026-10-10T03:04:05.000Z",
    priceLabel: "$0.08/张（账单实测）· 4K", measuredPrice: { parameters: { quality: "max" } } } });
  expect(modelPickerPriceData(model)).toBe("$0.08/张（账单实测）· 4K · 实测参数：质量=max");
  expect(modelPickerPriceCompact(model)).toBe("$0.08/张（账单实测）· 4K");
  expect(modelPickerPriceData({ ...model, metadata: { ...model.metadata, priceStatus: "partial" } }))
    .toBe("上次记录 · 采样时间 2026-10-10T03:04:05.000Z · $0.08/张（账单实测）· 4K · 实测参数：质量=max");
});
