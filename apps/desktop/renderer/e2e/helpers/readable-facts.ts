import { expect, type Locator } from "@playwright/test";

/** Check the same facts after punctuation summaries become definition grids. */
export async function expectDirectoryStat(summary: Locator, label: string, value: string | number) {
  const term = summary.locator("dt").filter({ hasText: new RegExp(`^${label}$`, "u") });
  await expect(term.locator("..").locator("dd")).toHaveText(String(value));
}

export async function expectQuotedAmount(quote: Locator, amount: string | number, currency: string, unit: string) {
  await expect(quote).toContainText(`${currency} / ${unit}`);
  const number = String(amount).split(".").join("\\.");
  await expect(quote.locator("td > span,dd").filter({ hasText: new RegExp(`^${number}(?:\\s|$)`, "u") }).first()).toBeVisible();
}

export function estimateAmount(price: Locator) {
  return price.locator(":scope > span, :scope > div").filter({ hasText: /^本次预计费用/u }).locator("strong");
}

