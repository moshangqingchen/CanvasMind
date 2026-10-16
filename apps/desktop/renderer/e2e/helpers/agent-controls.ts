import { expect, type Locator, type Page } from "@playwright/test";

export const agentPanel = (page: Page) =>
  page.getByRole("region", { name: "通用创作智能体", exact: true });
export const agentModelTrigger = (page: Page) =>
  agentPanel(page).getByRole("button", { name: "对话模型", exact: true });
export const agentModelDialog = (page: Page) =>
  page.getByRole("dialog", { name: "选择对话模型", exact: true });
export const agentSessionTrigger = (page: Page) =>
  agentPanel(page).getByRole("button", { name: "切换对话", exact: true });
export const agentSessionDialog = (page: Page) =>
  page.getByRole("dialog", { name: "切换对话", exact: true });
const cssAttribute = (value: string) =>
  value
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\a ")
    .replace(/\r/gu, "\\d ");
export const agentModelRow = (scope: Page | Locator, key: string) =>
  scope.locator(`button[data-model-key="${cssAttribute(key)}"]`);

export async function openAgentModels(page: Page) {
  const dialog = agentModelDialog(page);
  if (!(await dialog.isVisible())) await agentModelTrigger(page).click();
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function closeAgentModels(page: Page) {
  const dialog = agentModelDialog(page);
  if (await dialog.isVisible())
    await dialog
      .getByRole("button", { name: "关闭选择对话模型", exact: true })
      .click();
  await expect(dialog).toHaveCount(0);
}
export async function expectAgentModel(page: Page, key: string) {
  await expect(agentModelTrigger(page)).toHaveAttribute("data-model-key", key);
}
export async function chooseAgentModel(page: Page, key: string) {
  const dialog = await openAgentModels(page);
  await dialog
    .getByRole("searchbox", { name: "搜索对话模型", exact: true })
    .fill(key.split("\n")[1]!);
  const row = agentModelRow(dialog, key);
  await expect(row).toBeVisible();
  await row.click();
  await expectAgentModel(page, key);
  await closeAgentModels(page);
}
export async function chooseAgentReasoning(page: Page, value: string) {
  const dialog = await openAgentModels(page);
  const button = dialog.locator(
    `button[data-reasoning="${cssAttribute(value)}"]`,
  );
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await closeAgentModels(page);
}
export async function openAgentSessions(page: Page) {
  const dialog = agentSessionDialog(page);
  if (!(await dialog.isVisible())) await agentSessionTrigger(page).click();
  await expect(dialog).toBeVisible();
  return dialog;
}
