import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const journalKey = "super-canvas:node-configuration-journal:v1";
const models = [
  { id: "journal-image-a", name: "日志模型甲", operations: ["image.generate"], isDefault: true },
  { id: "journal-image-b", name: "日志模型乙", operations: ["image.generate"] },
];

async function openFixture(page: Page, request: APIRequestContext) {
  const providerResponse = await request.post("/api/providers", {
    data: {
      name: "配置日志隔离测试",
      provider: "rest",
      apiKey: "isolated-journal-test",
      config: {
        baseUrl: "https://journal.invalid",
        defaultModel: models[0]!.id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models },
      },
    },
  });
  expect(providerResponse.ok()).toBeTruthy();
  const provider = await providerResponse.json();
  await page.route(`**/api/providers/${provider.id}/models*`, (route) => route.fulfill({
    json: models,
    headers: { "X-Model-Scan-Status": "live" },
  }));
  let submissions = 0;
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      await route.abort();
    } else await route.continue();
  });
  const canvasResponse = await request.post("/api/canvas", {
    data: {
      title: "配置日志撤销回归",
      graph: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        edges: [],
        nodes: [{
          id: "source",
          type: "workflow",
          position: { x: 55, y: 70 },
          style: { width: 420, height: 180 },
          data: {
            nodeType: "image-generation",
            label: "日志回归",
            provider: "rest",
            connectionId: provider.id,
            model: models[0]!.id,
            parts: [],
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
            outputs: [{ id: "images", kind: "image", label: "图片" }],
            parameters: { n: 1 },
          },
        }],
      },
    },
  });
  expect(canvasResponse.ok()).toBeTruthy();
  const canvas = await canvasResponse.json();
  await page.goto(`/canvas/${canvas.id}`);
  const saveStatus = page.getByRole("button", { name: "画布自动保存状态", exact: true });
  await expect(saveStatus).toContainText("已保存");
  await page.getByRole("button", { name: "打开 日志回归 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "日志回归 模型与参数", exact: true });
  await expect(panel).toBeVisible();
  return { canvas, panel, saveStatus, assertNoSubmissions: () => expect(submissions).toBe(0) };
}

async function pendingConfigurations(page: Page, canvasId: string) {
  return page.evaluate(({ key, id }) => {
    const entries = JSON.parse(localStorage.getItem(key) ?? "[]") as { canvasId: string; token: string; data: { model: string } }[];
    return entries.filter((entry) => entry.canvasId === id);
  }, { key: journalKey, id: canvasId });
}

for (const redo of [false, true]) {
  test(`配置保存失败后${redo ? "撤销再重做" : "撤销"}，普通保存与刷新保留最终选择`, async ({ page, request }) => {
    const ui = await openFixture(page, request);
    let failSaves = true;
    await page.route(`**/api/canvas/${ui.canvas.id}`, async (route) => {
      if (failSaves && route.request().method() === "PUT") {
        await route.fulfill({ status: 503, json: { error: "隔离测试：临时保存失败" } });
      } else await route.continue();
    });
    await ui.panel.getByRole("combobox", { name: "日志回归 模型", exact: true }).click();
    await ui.panel.getByRole("option", { name: "日志模型乙", exact: true }).click();
    await expect(ui.saveStatus).toContainText("保存失败");
    const failedEntries = await pendingConfigurations(page, ui.canvas.id);
    expect(failedEntries[0]?.data.model).toBe("journal-image-b");
    await ui.panel.getByRole("button", { name: "关闭模型与参数面板" }).click();

    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => (await pendingConfigurations(page, ui.canvas.id))[0]?.data.model).toBe("journal-image-a");
    const undoneEntries = await pendingConfigurations(page, ui.canvas.id);
    expect(undoneEntries[0]?.token).not.toBe(failedEntries[0]?.token);
    if (redo) {
      await page.getByRole("button", { name: "重做", exact: true }).click();
      await expect.poll(async () => (await pendingConfigurations(page, ui.canvas.id))[0]?.data.model).toBe("journal-image-b");
      expect((await pendingConfigurations(page, ui.canvas.id))[0]?.token).not.toBe(undoneEntries[0]?.token);
    }

    failSaves = false;
    await page.keyboard.press("Control+s");
    await expect(ui.saveStatus).toContainText("已保存");
    await expect.poll(() => pendingConfigurations(page, ui.canvas.id)).toEqual([]);
    const expectedModel = redo ? "journal-image-b" : "journal-image-a";
    const savedModel = async () => {
      const response = await request.get(`/api/canvas/${ui.canvas.id}`);
      return (await response.json()).graph.nodes.find((node: { id: string }) => node.id === "source").data.model;
    };
    await expect.poll(savedModel).toBe(expectedModel);
    await page.reload();
    await page.getByRole("button", { name: "打开 日志回归 模型与参数", exact: true }).click();
    await expect(ui.panel.getByRole("combobox", { name: "日志回归 模型", exact: true })).toContainText(redo ? "日志模型乙" : "日志模型甲");
    await expect(ui.saveStatus).toContainText("已保存");
    await expect.poll(savedModel).toBe(expectedModel);
    ui.assertNoSubmissions();
  });
}

test("保存响应尚未返回时再次切换模型，旧响应保留新日志并最终保存最新选择", async ({ page, request }) => {
  const ui = await openFixture(page, request);
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondRequestGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  let saveCount = 0;
  let firstCommitted = false;
  let secondStarted = false;
  await page.route(`**/api/canvas/${ui.canvas.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    saveCount++;
    if (saveCount === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      firstCommitted = true;
      await firstResponseGate;
      return route.fulfill({ response });
    }
    if (saveCount === 2) {
      secondStarted = true;
      await secondRequestGate;
    }
    return route.continue();
  });
  const chooseModel = async (name: string) => {
    await ui.panel.getByRole("combobox", { name: "日志回归 模型", exact: true }).click();
    await ui.panel.getByRole("option", { name, exact: true }).click();
  };
  const savedModel = async () => {
    const response = await request.get(`/api/canvas/${ui.canvas.id}`);
    return (await response.json()).graph.nodes.find((node: { id: string }) => node.id === "source").data.model;
  };
  try {
    await chooseModel("日志模型乙");
    await expect.poll(() => firstCommitted).toBe(true);
    await expect.poll(savedModel).toBe("journal-image-b");
    const firstToken = (await pendingConfigurations(page, ui.canvas.id))[0]?.token;
    expect(firstToken).toBeTruthy();

    await chooseModel("日志模型甲");
    await expect.poll(async () => (await pendingConfigurations(page, ui.canvas.id))[0]?.data.model).toBe("journal-image-a");
    const latestToken = (await pendingConfigurations(page, ui.canvas.id))[0]?.token;
    expect(latestToken).toBeTruthy();
    expect(latestToken).not.toBe(firstToken);
    expect(saveCount).toBe(1);

    releaseFirst();
    // The queue starts the second PUT only after acknowledging the first.
    // Hold it here to inspect the journal before the newer save can clear it.
    await expect.poll(() => secondStarted).toBe(true);
    expect(await pendingConfigurations(page, ui.canvas.id)).toEqual([
      expect.objectContaining({ token: latestToken, data: expect.objectContaining({ model: "journal-image-a" }) }),
    ]);
    await expect.poll(savedModel).toBe("journal-image-b");

    releaseSecond();
    await expect(ui.saveStatus).toContainText("已保存");
    await expect.poll(() => pendingConfigurations(page, ui.canvas.id)).toEqual([]);
    await expect.poll(savedModel).toBe("journal-image-a");
    await page.reload();
    await page.getByRole("button", { name: "打开 日志回归 模型与参数", exact: true }).click();
    await expect(ui.panel.getByRole("combobox", { name: "日志回归 模型", exact: true })).toContainText("日志模型甲");
    await expect(ui.saveStatus).toContainText("已保存");
    await expect.poll(savedModel).toBe("journal-image-a");
    ui.assertNoSubmissions();
  } finally {
    releaseFirst();
    releaseSecond();
  }
});
