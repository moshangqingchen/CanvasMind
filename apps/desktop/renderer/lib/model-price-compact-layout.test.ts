import { expect, it } from "vitest";
import { compactPriceParts } from "./model-price-compact-layout";

it("keeps amount, currency and unit together, with the tier count in its own block", () => {
  expect(compactPriceParts("0.025–0.44 CNY / 张 · 20 档")).toEqual(["0.025–0.44 CNY / 张", " · 20 档"]);
  expect(compactPriceParts("1–2 额度 / 次（参考） · 2 档")).toEqual(["1–2 额度 / 次", "（参考）", " · 2 档"]);
});

it("keeps each complete confidence mark intact", () => {
  expect(compactPriceParts("Token 计价（目录快照）")).toEqual(["Token 计价", "（目录快照）"]);
  expect(compactPriceParts("0.08 USD / 张（参考） · 时段倍率")).toEqual(["0.08 USD / 张", "（参考）", " · 时段倍率"]);
});

it.each([
  "图片生成 / 图片编辑 · 上次价格 · 采样时间 2026-10-18T08:00:00Z · 0.4 CNY / 张（参考） · 3 档",
  "0.08 CNY / 张（上次价格 · 采样时间 2026-10-18T08:00:00Z）",
  "0.08 USD / 张（记录（图片编辑）） · （目录快照）",
  "0.08一张，原生2K/4K", "—", "",
])("preserves every character of %s", label => {
  expect(compactPriceParts(label).join("")).toBe(label);
  for (const part of compactPriceParts(label)) expect(part).not.toMatch(/^\s*·\s*$/u);
});
