import { expect, it } from "vitest";
import { modelPickerPriceData } from "./model-picker-data";

it("shows Chuangxiang weekday peak pricing without implying a weekend multiplier", () => {
  const label = modelPickerPriceData({ id: "deepseek-v4-pro", name: "deepseek-v4-pro", operations: [], pricing: {
    kind: "token", currency: "USD", inputPerMillion: 1, outputPerMillion: 2,
    checkedAt: "2026-10-14T23:27:38Z", confidence: "exact",
    timeMultipliers: [{ timeZone: "Asia/Shanghai", startHour: 9, endHour: 12, multiplier: 2, weekdaysOnly: true }],
  } });
  expect(label).toContain("周一至周五 9:00–12:00 ×2");
  expect(label).toContain("上海");
});
