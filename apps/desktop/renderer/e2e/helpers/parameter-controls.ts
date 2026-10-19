import { expect, type Locator } from "@playwright/test";

export async function chooseParameterSegment(group: Locator, value: string) {
  if (await group.getAttribute("data-display") === "static") {
    await expect(group).toHaveAttribute("data-value", value);
    return;
  }
  await group.locator(`button[data-value=${JSON.stringify(value)}]`).click();
}

export async function expectParameterSegmentValue(group: Locator, value: string) {
  if (await group.getAttribute("data-display") === "static") await expect(group).toHaveAttribute("data-value", value);
  else await expect(group.locator(`button[data-value=${JSON.stringify(value)}]`)).toHaveAttribute("aria-pressed", "true");
}

/** Operate the real visible control; support legacy native fields during migration. */
export async function chooseParameterOption(field: Locator, value: string) {
  if (await field.evaluate(element => element instanceof HTMLSelectElement)) {
    await field.selectOption(value);
    return;
  }
  if (await field.getAttribute("role") === "textbox" && await field.getAttribute("aria-readonly") === "true") {
    await expect(field, "A static contract value has no alternative selection").toHaveAttribute("data-value", value);
    return;
  }
  await field.click();
  const listId = await field.getAttribute("aria-controls");
  expect(listId, "Dropdown exposes its owned listbox").toBeTruthy();
  const list = field.page().locator(`[id=${JSON.stringify(listId)}]`);
  const option = list.getByRole("option").locator(`xpath=self::*[@data-value=${xpathLiteral(value)}]`);
  await expect(option).toHaveCount(1);
  await option.click();
}

function xpathLiteral(value: string) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map(part => `'${part}'`).join(', "\'", ')})`;
}

export async function expectParameterValue(field: Locator, value: string) {
  if (await field.evaluate(element => element instanceof HTMLSelectElement || element instanceof HTMLInputElement)) {
    await expect(field).toHaveValue(value);
  } else await expect(field).toHaveAttribute("data-value", value);
}

export async function readParameterOptions(field: Locator): Promise<Array<{ value: string; label: string; disabled: boolean }>> {
  if (await field.evaluate(element => element instanceof HTMLSelectElement)) {
    return field.locator("option").evaluateAll(options => options.map(option => ({ value: (option as HTMLOptionElement).value,
      label: option.textContent?.trim() ?? "", disabled: (option as HTMLOptionElement).disabled })));
  }
  if (await field.getAttribute("role") === "textbox" && await field.getAttribute("aria-readonly") === "true") {
    return [{ value: (await field.getAttribute("data-value")) ?? "", label: (await field.textContent())?.trim() ?? "", disabled: false }];
  }
  await field.click();
  const listId = await field.getAttribute("aria-controls");
  expect(listId).toBeTruthy();
  const options = await field.page().locator(`[id=${JSON.stringify(listId)}]`).getByRole("option").evaluateAll(options => options.map(option => ({
    value: option.getAttribute("data-value") ?? "", label: option.textContent?.trim() ?? "", disabled: option.getAttribute("aria-disabled") === "true",
  })));
  await field.press("Escape");
  return options;
}

export async function openParameterDetails(panel: Locator, label: string) {
  const trigger = panel.getByRole("button", { name: label, exact: true });
  if (await trigger.count()) {
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    return;
  }
  const summary = panel.locator("summary").filter({ hasText: new RegExp(`^${label}$`, "u") });
  if (await summary.count() && await summary.locator("..").getAttribute("open") === null) await summary.click();
}
