import { test, expect } from "@playwright/test";

test("本机素材通道保存后清空凭据输入，重开设置保留状态", async ({ page }) => {
  await page.addInitScript(() => {
    let state = { enabled: false, baseUrl: "", tokenConfigured: false, phase: "disabled", message: "", port: 3210 };
    const noop = () => () => {};
    window.superCanvasDesktop = {
      getReferenceChannel: async () => state,
      saveReferenceChannel: async input => {
        if (input.tunnelToken !== "isolated-test-credential") throw new Error("测试凭据未传递");
        state = { ...state, enabled: input.enabled, baseUrl: input.baseUrl, tokenConfigured: true, phase: "ready", message: "素材通道已连通" };
        return state;
      },
      onReferenceChannel: noop,
      getUpdate: async () => ({ status: "idle", currentVersion: "0.2.29" }) as never,
      update: async () => {}, onPrepareExit: noop, completePrepareExit: () => {},
      onOpenUpdate: noop, onUpdate: noop, onDraining: noop, cancelExit: async () => {},
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await page.getByRole("tab", { name: "素材通道", exact: true }).click();
  await page.getByRole("checkbox", { name: "启用本机素材通道" }).check();
  await page.getByLabel("素材域名", { exact: true }).fill("https://assets.example.com");
  const credential = page.getByLabel("Cloudflare 隧道凭据", { exact: true });
  await expect(credential).toHaveAttribute("type", "password");
  await credential.fill("isolated-test-credential");
  await page.getByRole("button", { name: "保存并连接" }).click();
  await expect(page.getByRole("dialog", { name: "供应商与模型设置" }).getByRole("status")).toContainText("素材通道已连通");
  await expect(credential).toHaveValue("");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await page.getByRole("tab", { name: "素材通道", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "启用本机素材通道" })).toBeChecked();
  await expect(page.getByLabel("素材域名", { exact: true })).toHaveValue("https://assets.example.com");
  await expect(credential).toHaveValue("");
});
