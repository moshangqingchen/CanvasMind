import { expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { modelPickerPriceCompact, modelPickerPriceData } from "./model-picker-data";

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
