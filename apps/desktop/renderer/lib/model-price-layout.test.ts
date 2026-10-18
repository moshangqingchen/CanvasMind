import { describe, expect, it } from "vitest";
import type { ModelDescriptor, StructuredPriceTier } from "@super-canvas/providers";
import { selectedModelPriceTier } from "@super-canvas/providers/media-billing";
import { modelPickerPriceCompact, modelPickerPriceData, modelPickerStructuredPrice, modelPriceHasDetails } from "./model-picker-data";
import { modelPriceLayout, modelPricePivotCellMatches } from "./model-price-layout";
import { modelEstimatedCost, modelEstimatedQuote } from "./model-display";

const checkedAt = "2026-10-16T12:30:00Z";
const tier = (id: string, values: Record<string, string>, price: number): StructuredPriceTier => ({ id, label: id, price, conditionMode: "all",
  conditions: Object.entries(values).map(([parameter, value]) => ({ parameter, operator: "equals", value })) });
const model = (tiers: readonly StructuredPriceTier[] = []): ModelDescriptor => ({ id: "tariff-fixture", name: "测试价格", operations: [],
  pricing: { kind: "tiered", currency: "CNY", billingUnit: "image", confidence: "exact", checkedAt, tiers } });
const pivotModel = () => model([tier("flare-1k-xhigh", { series: "flare", tier: "1k", quality: "xhigh" }, .32),
  tier("flare-1k-max", { series: "flare", tier: "1k", quality: "max" }, .32),
  tier("flare-1k", { series: "flare", tier: "1k" }, .16),
  tier("flare-2k-xhigh", { series: "flare", tier: "2k", quality: "xhigh" }, .36),
  tier("flare-2k-max", { series: "flare", tier: "2k", quality: "max" }, .36),
  tier("flare-2k", { series: "flare", tier: "2k" }, .18),
  tier("flare", { series: "flare" }, .025),
  tier("sunburst-1k-xhigh", { series: "sunburst", tier: "1k", quality: "xhigh" }, .36),
  tier("sunburst-1k-max", { series: "sunburst", tier: "1k", quality: "max" }, .36),
  tier("sunburst-1k", { series: "sunburst", tier: "1k" }, .18),
  tier("sunburst", { series: "sunburst" }, .025)]);

describe("structured prices and stable report strings", () => {
  it("keeps all conditions and amounts, using this model's own parameter labels", () => {
    const original = pivotModel();
    original.parameters = [{ key: "series", label: "系列", control: "text" }, { key: "tier", label: "清晰度", control: "text" }];
    const before = JSON.stringify(original), data = modelPickerStructuredPrice(original);
    expect(data.tiers).toHaveLength(11);
    expect(data.tiers[0]).toMatchObject({ sourceIndex: 0, amount: .32, matching: "ordered", conditions: [
      { parameter: "series", label: "系列", operator: "equals", value: "flare" },
      { parameter: "tier", label: "清晰度", operator: "equals", value: "1k" },
      { parameter: "quality", label: "质量", operator: "equals", value: "xhigh" },
    ] });
    expect(modelPickerPriceData(original)).toContain("series=flare 且 tier=1k 且 质量=xhigh · 0.32 CNY / 张");
    expect(modelPickerPriceCompact(original)).toBe("0.025–0.36 CNY / 张 · 11 档");
    expect(JSON.stringify(original)).toBe(before);
    expect(modelPriceHasDetails(data)).toBe(true);
  });

  it("keeps fixed, token components, currency, operation and time-window facts", () => {
    const original: ModelDescriptor = { id: "token-fixture", name: "Token", operations: [], metadata: { billingIncludesInputDuration: true }, pricing: {
      kind: "token", currency: "credits", unitAmount: 0, inputPerMillion: 2, outputPerMillion: 4, imageOutputPerMillion: 9,
      checkedAt, confidence: "snapshot", timeMultipliers: [{ timeZone: "Asia/Shanghai", startHour: 9, endHour: 12, multiplier: 2, weekdaysOnly: true }],
      evidence: { status: "published", checkedAt, sourceKey: "fixture", operations: ["image.generate", "image.edit"] },
    } };
    expect(modelPickerPriceData(original)).toBe("图片生成 / 图片编辑 · 0 额度 / 1M tokens；输入 2 额度 / 1M tokens；输出 4 额度 / 1M tokens；图片输出 9 额度 / 1M tokens（目录快照）；时段倍率：上海 周一至周五 9:00–12:00 ×2；计费时长：输入 + 输出视频");
    expect(modelPickerPriceCompact(original)).toBe("图片生成 / 图片编辑 · Token 计价（目录快照） · 时段倍率");
    expect(modelPickerStructuredPrice(original)).toMatchObject({ fixedAmount: 0, currency: "credits", displayCurrency: "额度", unit: "1M tokens", confidence: "snapshot",
      tokenRates: [{ label: "输入", amount: 2 }, { label: "输出", amount: 4 }, { label: "图片输出", amount: 9 }],
      operations: [{ value: "image.generate", label: "图片生成" }, { value: "image.edit", label: "图片编辑" }],
      timeMultipliers: original.pricing!.timeMultipliers, billingIncludesInputDuration: true });
  });

  it("retains a historical branch's own sample and reports mixed provenance exactly", () => {
    const original = model([tier("now", { quality: "max" }, .5), { ...tier("old", { quality: "high" }, .2),
      evidence: { status: "retained", checkedAt: "2026-10-01T00:00:00Z", sourceKey: "old" } }]);
    original.pricing!.tiers![0]!.evidence = { status: "published", checkedAt, sourceKey: "now" };
    expect(modelPickerPriceData(original)).toBe("部分上次价格 · 质量=max · 0.5 CNY / 张；质量=high · 0.2 CNY / 张（上次价格 · 采样时间 2026-10-01T00:00:00Z）");
    expect(modelPickerStructuredPrice(original)).toMatchObject({ historical: { label: "部分上次价格" }, tiers: [
      { historical: false, checkedAt }, { historical: true, checkedAt: "2026-10-01T00:00:00Z" },
    ] });
    // Runtime evidence can predate the typed contract; do not change old report strings.
    original.pricing!.tiers![1]!.evidence = { status: "retained", sourceKey: "old" } as NonNullable<StructuredPriceTier["evidence"]>;
    expect(modelPickerPriceData(original)).toContain("（上次价格 · 采样时间 undefined）");
  });

  it("keeps the original measured label and scope even with other samples and a blocked quote", () => {
    const original = model([tier("stale", { quality: "max" }, 5)]);
    original.metadata = { priceSource: "generated-result", priceStatus: "partial", priceCheckedAt: checkedAt, priceLabel: "$0.08/张（账单实测）· 4K",
      measuredPrice: { amount: .08, currency: "USD", unit: "image", checkedAt, parameters: {
        quality: "max", n: 1, reference_images: ["https://fixture.invalid/a.png"], prompt: "不公开", image: "https://fixture.invalid/a.png",
      } }, catalogMeasuredPrices: [{ amount: .12, currency: "USD", parameters: { quality: "high" } }] };
    expect(modelPickerPriceData(original)).toBe(`上次记录 · 采样时间 ${checkedAt} · $0.08/张（账单实测）· 4K · 实测参数：质量=max，数量=1，reference_images数量=1`);
    expect(modelPickerPriceCompact(original)).toBe(`上次记录 · 采样时间 ${checkedAt} · $0.08/张（账单实测）· 4K`);
    const data = modelPickerStructuredPrice(original);
    expect(data.measuredPrices).toHaveLength(2);
    expect(data.measuredPrices[0]).toMatchObject({ label: "$0.08/张（账单实测）· 4K", amount: .08, currency: "USD", unit: "张",
      parameters: [{ parameter: "quality", value: "max" }, { parameter: "n", value: "1" }, { parameter: "reference_images", value: "1" }] });
    expect(JSON.stringify(data.measuredPrices)).not.toContain("fixture.invalid");
    expect(JSON.stringify(data.measuredPrices)).not.toContain("不公开");
  });

  it("preserves omitted measured parameters, prose quotes, and absent quotes", () => {
    expect(modelPickerPriceData({ ...model(), metadata: { priceSource: "generated-result", priceLabel: "0.3 CNY / 张", measuredPrice: { parameters: {} } } }))
      .toBe("0.3 CNY / 张 · 实测请求参数：省略");
    const prose: ModelDescriptor = { id: "prose", name: "prose", operations: [], metadata: { priceLabel: "0.08一张，原生2K/4K（上次价格）", priceCheckedAt: checkedAt } };
    expect(modelPickerStructuredPrice(prose)).toMatchObject({ prose: "0.08一张，原生2K/4K", historical: { label: "上次价格", checkedAt } });
    expect(modelPickerPriceData(prose)).toBe(`上次价格 · 采样时间 ${checkedAt} · 0.08一张，原生2K/4K`);
    expect(modelPickerStructuredPrice({ ...prose, metadata: { priceLabel: "未确认" } }).prose).toBeUndefined();
    expect(modelPickerPriceData(null)).toBe("—");
    expect(modelPriceHasDetails(modelPickerStructuredPrice(null))).toBe(false);
  });

  it("previews a fixed fallback plus one tier, while a measured sample hides stale tariff previews", () => {
    const original = model([tier("conditional", { quality: "max" }, .5)]);
    original.pricing!.unitAmount = .1;
    expect(modelPriceHasDetails(modelPickerStructuredPrice(original))).toBe(true);
    original.metadata = { priceSource: "generated-result", priceLabel: "0.4 CNY / 张", measuredPrice: { parameters: { quality: "high" } } };
    expect(modelPriceHasDetails(modelPickerStructuredPrice(original))).toBe(false);
  });
});

describe("price pivots reflect actual first-match semantics", () => {
  it("pivots a regular series/tier/quality hierarchy and preserves missing-dimension matching", () => {
    const original = pivotModel(), layout = modelPriceLayout(modelPickerStructuredPrice(original).tiers);
    expect(layout.kind).toBe("pivot");
    if (layout.kind !== "pivot") return;
    expect(layout.groups.map(group => group.label)).toEqual(["series flare", "series sunburst"]);
    expect(layout.columns.map(column => column.label)).toEqual(["xhigh", "max", "其余质量"]);
    expect(layout.groups[0]!.rows.map(row => row.label)).toEqual(["1k", "2k", "其余 tier"]);
    expect(layout.groups[0]!.rows[0]!.cells.map(item => item?.amount)).toEqual([.32, .32, .16]);
    expect(layout.groups[0]!.rows[2]!.cells.map(item => item?.amount)).toEqual([.025, .025, .025]);
    for (let groupIndex = 0; groupIndex < layout.groups.length; groupIndex++) for (let rowIndex = 0; rowIndex < layout.groups[groupIndex]!.rows.length; rowIndex++)
      for (let columnIndex = 0; columnIndex < layout.columns.length; columnIndex++) {
        const group = layout.groups[groupIndex]!, row = group.rows[rowIndex]!, column = layout.columns[columnIndex]!;
        const parameters = { series: group.value!, tier: row.value ?? "8k", quality: column.value ?? "medium" };
        expect(row.cells[columnIndex]?.id).toBe(selectedModelPriceTier(original.pricing!, parameters)?.id);
        expect(modelPricePivotCellMatches(layout, groupIndex, rowIndex, columnIndex, parameters)).toBe(true);
      }
    const current = { series: "flare", tier: "8k", quality: "max" };
    expect(layout.groups.flatMap((group, groupIndex) => group.rows.flatMap((row, rowIndex) => row.cells.flatMap((_, columnIndex) =>
      modelPricePivotCellMatches(layout, groupIndex, rowIndex, columnIndex, current) ? [true] : [])))).toHaveLength(1);
  });

  it("pivots complete equal-condition grids and legacy unique-dimension tariffs", () => {
    const regular = modelPriceLayout(modelPickerStructuredPrice(model([tier("one", { resolution: "1K", quality: "high" }, 1),
      tier("two", { resolution: "2K", quality: "high" }, 2)])).tiers);
    expect(regular.kind).toBe("pivot");
    const legacy = modelPriceLayout(modelPickerStructuredPrice(model([
      { id: "1k", dimension: "resolution", value: "1K", label: "1K", price: 1 },
      { id: "4k", dimension: "resolution", value: "4K", label: "4K", price: 4 },
    ])).tiers);
    expect(legacy.kind).toBe("pivot");
    if (legacy.kind === "pivot") expect(modelPricePivotCellMatches(legacy, 0, 1, 0, { resolution: "4k" })).toBe(true);
  });

  it.each([
    ["tier", "其余 tier"], ["image_size", "其余 image_size"], ["_tier", "其余 _tier"],
    ["4K档位", "其余 4K档位"], ["质量", "其余质量"], ["档位", "其余档位"],
  ])("spaces only the generated remainder boundary for %s without changing raw data", (label, expected) => {
    const original = pivotModel();
    original.parameters = [{ key: "tier", label, control: "text" }];
    const before = JSON.stringify(original), reportBefore = modelPickerPriceData(original);
    const data = modelPickerStructuredPrice(original), layout = modelPriceLayout(data.tiers);
    expect(layout.kind).toBe("pivot");
    if (layout.kind !== "pivot") return;
    expect(layout.groups[0]!.rows.at(-1)!.label).toBe(expected);
    expect(layout.groups[0]!.label).toBe("series flare");
    expect(layout.columns.at(-1)!.label).toBe("其余质量");
    expect(data.tiers[0]!.conditions[1]).toMatchObject({ parameter: "tier", label, value: "1k" });
    expect(JSON.stringify(original)).toBe(before);
    expect(modelPickerPriceData(original)).toBe(reportBefore);
  });

  it.each(["or", "contains", "none", "otherwise", "dimensions", "shadowed"])("falls back without losing facts for %s", kind => {
    let tiers = [tier("a", { resolution: "1K", quality: "max" }, 1), tier("b", { resolution: "2K", quality: "high" }, 2)];
    if (kind === "or") tiers[0] = { ...tiers[0]!, conditionMode: "any" };
    if (kind === "contains") tiers[0] = { ...tiers[0]!, conditions: [{ parameter: "resolution", operator: "contains", value: "K" }] };
    if (kind === "none") tiers[0] = { ...tiers[0]!, conditionMode: "none" };
    if (kind === "otherwise") tiers[1] = { id: "b", label: "fallback", price: 2, otherwise: true };
    if (kind === "dimensions") tiers = [tier("a", { resolution: "1K" }, 1), tier("b", { quality: "max" }, 2)];
    if (kind === "shadowed") tiers = [tier("a", { resolution: "1K" }, 1), tier("b", { resolution: "1K", quality: "max" }, 2)];
    const data = modelPickerStructuredPrice(model(tiers)), layout = modelPriceLayout(data.tiers);
    expect(layout.kind).toBe("list");
    if (layout.kind === "list") expect(layout.tiers).toEqual(data.tiers);
  });

  it("shares normalized defaults, aliases and tariff indices with the displayed estimate", () => {
    const original = model([tier("high", { resolution: "4K", quality: "high" }, 2), tier("max", { resolution: "4K", quality: "max" }, 3)]);
    original.parameters = [{ key: "resolution", label: "分辨率", control: "text", default: "4K" }, { key: "quality", label: "质量", control: "text", default: "max" },
      { key: "n", label: "数量", control: "number", default: 2 }];
    const quote = modelEstimatedQuote(original, {});
    expect(quote).toMatchObject({ cost: "6 CNY", tierIndex: 1, parameters: { resolution: "4K", quality: "max", n: 2 } });
    expect(modelEstimatedCost(original, {})).toBe(quote?.cost);
    const historical = model([tier("retained", { quality: "max" }, 2)]);
    historical.metadata = { priceStatus: "partial" };
    expect(modelEstimatedQuote(historical, { quality: "max" })).toBeUndefined();
  });
});
