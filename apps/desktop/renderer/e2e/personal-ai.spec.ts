import { expect, test, type Page } from "@playwright/test";
import type { ProviderConnectionView } from "../lib/client-api";

async function mockPersonalAi(page: Page) {
  let connections: ProviderConnectionView[] = [];
  const actions: string[] = [];
  const saves: Record<string, unknown>[] = [];
  await page.route("**/api/suppliers**", route => route.fulfill({ json: [] }));
  await page.route("**/api/providers**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/providers/cli-template") return route.fulfill({ json: { executable: "C:\\Program Files\\nodejs\\node.exe", args: ["D:\\canvas\\mock-adapter.mjs"] } });
    if (url.pathname.endsWith("/cli")) {
      const action = route.request().postDataJSON().action;
      actions.push(action);
      const connection = connections.find(item => url.pathname.includes(item.id))!;
      connection.config.cliStatus = { state: "ready", supportsCancel: false };
      if (action === "describe") connection.config.modelCatalogModels = [{ id: "demo-video", name: "模拟视频模型", operations: ["video.generate"], parameters: [
        { key: "resolution", label: "分辨率", control: "select", default: "1080p", options: [{ label: "1080p", value: "1080p" }, { label: "720p", value: "720p" }] },
        { key: "duration", label: "秒数", control: "select", default: 5, options: [{ label: "5 秒", value: 5 }, { label: "10 秒", value: 10 }] },
      ] }];
      return route.fulfill({ json: { connection, models: connection.config.modelCatalogModels ?? [] } });
    }
    if (url.pathname === "/api/providers") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON(); saves.push(body);
        const saved = { ...body, id: body.id || `cli-${saves.length}`, apiKey: "", apiKeySet: false, apiKeyUsable: false, config: { ...body.config, cliStatus: { state: "unconfigured" }, modelCatalogModels: [] } };
        connections = [...connections.filter(item => item.id !== saved.id), saved];
        return route.fulfill({ json: saved });
      }
      return route.fulfill({ json: connections });
    }
    if (route.request().method() === "DELETE") { connections = connections.filter(item => !url.pathname.endsWith(item.id)); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: [] });
  });
  return { actions, saves };
}

async function openPersonalAi(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await page.getByRole("tab", { name: "个人 AI 网站", exact: true }).click();
  return page.getByRole("tabpanel", { name: "个人 AI 网站", exact: true });
}

test("即梦预留连接无需 Key，保存和重新打开均不执行 CLI", async ({ page }) => {
  const api = await mockPersonalAi(page);
  const panel = await openPersonalAi(page);
  await expect(panel.getByLabel("网站名称", { exact: true })).toHaveValue("即梦");
  await expect(panel.getByText("等待接入后同步。画布会按所选模型显示它实际支持的参数。")).toBeVisible();
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0]).not.toHaveProperty("apiKey");
  await expect(panel.getByRole("button", { name: "检测连接", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await page.getByRole("tab", { name: "个人 AI 网站", exact: true }).click();
  await expect(panel.getByLabel("连接名称", { exact: true })).toHaveValue("即梦");
  expect(api.actions).toEqual([]);
});

test("模拟模板仅显式检测同步时启动操作，动态目录显示分辨率与秒数", async ({ page }, testInfo) => {
  const api = await mockPersonalAi(page);
  const panel = await openPersonalAi(page);
  await panel.getByRole("button", { name: "模拟连接", exact: true }).click();
  await expect(panel.getByLabel("可执行文件", { exact: true })).toHaveValue("C:\\Program Files\\nodejs\\node.exe");
  expect(api.actions).toEqual([]);
  await panel.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(panel.getByRole("button", { name: "检测连接", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "检测连接", exact: true }).click();
  await expect.poll(() => api.actions).toEqual(["test"]);
  await panel.getByRole("button", { name: "同步模型与参数", exact: true }).click();
  await expect(panel.getByText("模拟视频模型", { exact: true })).toBeVisible();
  await expect(panel.getByRole("region", { name: "已同步的模型与参数" })).toContainText("1080p / 720p");
  await expect(panel.getByRole("region", { name: "已同步的模型与参数" })).toContainText("5 秒 / 10 秒");
  expect(api.actions).toEqual(["test", "describe"]);
  await page.screenshot({ path: testInfo.outputPath("personal-ai-settings.png") });
});
