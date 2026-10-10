import { expect, test } from "@playwright/test";
import { cangyuanCurrentModel } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

// Current supplier documents declare 21:9 but do not declare 9:21.
const ratios = ["auto", "1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9"];

for (const id of ["gpt-image-2-x", "gpt-image-2.5-x"]) {
  test(`${id} 原生计费档、全部比例和手选质量保存恢复`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1400 });
    const descriptor = cangyuanCurrentModel({ id, name: id, operations: ["image.generate", "image.edit"] });
    const connectionResponse = await request.post("/api/providers", { data: {
      name: `隔离新接口参数 ${id}`, provider: "rest", apiKey: "isolated-no-paid-generation",
      config: { baseUrl: "https://parameters.invalid", defaultModel: id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } },
    } });
    expect(connectionResponse.ok()).toBeTruthy();
    const connection = await connectionResponse.json();
    const created = await request.post("/api/canvas", { data: { title: `新接口参数 ${id}`, graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow",
        position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: {
          nodeType: "image-generation", label: "新接口参数", provider: "rest", connectionId: connection.id,
          model: id, qualityMode: "highest", parameters: { tier: "4k", aspect_ratio: "auto", quality: "max",
            ...(id === "gpt-image-2.5-x" ? { series: "sunburst" } : {}) }, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }],
        } }],
    } } });
    expect(created.ok()).toBeTruthy();
    const canvas = await created.json();
    let submissions = 0;
    await page.route("**/api/runs", async route => {
      if (route.request().method() === "POST") { submissions++; await route.abort(); }
      else await route.continue();
    });
    await page.goto(`/canvas/${canvas.id}`);
    const open = () => page.getByRole("button", { name: "打开 新接口参数 模型与参数", exact: true }).click();
    await open();
    const panel = page.getByRole("dialog", { name: "新接口参数 模型与参数" });
    const tier = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    const ratio = panel.getByLabel("画面比例", { exact: true });
    const quality = panel.getByLabel("质量", { exact: true });
    await expect(quality).toHaveValue("max");
    const expectedQualities = id === "gpt-image-2.5-x" ? ["auto", "low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high", "xhigh", "max"];
    expect(await quality.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value).filter(Boolean))).toEqual(expectedQualities);
    for (const value of ["1k", "2k", "4k"]) {
      const choice = tier.getByRole("button", { name: value.toUpperCase(), exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      expect(await ratio.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value).filter(Boolean))).toEqual(ratios);
      await ratio.selectOption("21:9");
      await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
        .toMatchObject({ tier: value, aspect_ratio: "21:9", quality: "max" });
    }
    await quality.selectOption("low");
    if (id === "gpt-image-2.5-x") await panel.getByLabel("产品线", { exact: true }).selectOption("flare");
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
      .toMatchObject({ tier: "4k", aspect_ratio: "21:9", quality: "low", ...(id === "gpt-image-2.5-x" ? { series: "flare" } : {}) });
    await page.reload(); await open();
    await expect(tier.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(ratio).toHaveValue("21:9");
    await expect(quality).toHaveValue("low");
    if (id === "gpt-image-2.5-x") await expect(panel.getByLabel("产品线", { exact: true })).toHaveValue("flare");
    const width = panel.getByLabel("图片宽度", { exact: true });
    const height = panel.getByLabel("图片高度", { exact: true });
    await expect(width).toHaveCount(1);
    await expect(height).toHaveCount(1);
    await expect(width).toBeEditable();
    await expect(width).toHaveAttribute("min", "1");
    await expect(width).toHaveAttribute("step", "1");
    await expect(width).not.toHaveAttribute("max");
    await expect(panel.getByRole("checkbox", { name: /16 倍数/u })).toHaveCount(0);
    const customSize = panel.locator(".parameter-dimensions").filter({ has: page.getByLabel("图片宽度", { exact: true }) });
    await expect(customSize).toContainText("自定义宽高");
    await expect(customSize).toContainText("官网未公布逐比例像素表、宽高步长或数值预算");
    // Preserve explicit integer pixels without inventing a 16px constraint or
    // claiming the supplier's unpublished tier budget accepts this combination.
    await width.fill("1111");
    await height.fill("777");
    await height.press("Enter");
    await expect(width).toHaveValue("1111");
    await expect(height).toHaveValue("777");
    const savedParameters = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
    await expect.poll(savedParameters).toMatchObject({ tier: "4k", size: "1111x777", quality: "low" });
    await expect.poll(async () => (await savedParameters()).aspect_ratio).toBeUndefined();
    await page.reload(); await open();
    await expect(width).toHaveValue("1111");
    await expect(height).toHaveValue("777");
    await expect(ratio).toHaveValue("");
    await ratio.selectOption("21:9");
    await expect.poll(savedParameters).toMatchObject({ tier: "4k", aspect_ratio: "21:9", quality: "low" });
    await expect.poll(async () => (await savedParameters()).size).toBeUndefined();
    await expect(width).toHaveValue("");
    await expect(height).toHaveValue("");
    expect(submissions).toBe(0);
    await panel.screenshot({ path: testInfo.outputPath("cangyuan-current-parameters.png") });
  });
}
