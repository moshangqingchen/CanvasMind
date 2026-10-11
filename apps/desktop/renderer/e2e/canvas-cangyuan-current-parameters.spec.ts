import { expect, test } from "@playwright/test";
import { cangyuanCurrentModel } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";


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
    const highest = id === "gpt-image-2.5-x" ? "max" : "high";
    await expect(quality).toHaveValue(highest);
    await expect(ratio).toHaveCount(0);
    const preset = panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
    await expect(panel.getByLabel("清晰度 / 计费档位", { exact: true })).toHaveCount(0);
    const expectedQualities = id === "gpt-image-2.5-x" ? ["auto", "low", "medium", "high", "xhigh", "max"] : ["auto", "low", "medium", "high"];
    expect(await quality.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value).filter(Boolean))).toEqual(expectedQualities);
    for (const value of ["1k", "2k", "4k"]) {
      const choice = tier.getByRole("button", { name: value.toUpperCase(), exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      const pixels = { "1k": "1552x672", "2k": "3120x1344", "4k": "3840x1648" }[value]!;
      await preset.selectOption(pixels);
      await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
        .toMatchObject({ tier: value, size_tier: value.toUpperCase(), size: pixels, quality: highest });
    }
    await quality.selectOption("low");
    if (id === "gpt-image-2.5-x") await panel.getByLabel("产品线", { exact: true }).selectOption("flare");
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
      .toMatchObject({ tier: "4k", size: "3840x1648", quality: "low", ...(id === "gpt-image-2.5-x" ? { series: "flare" } : {}) });
    await page.reload(); await open();
    await expect(tier.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(preset).toHaveValue("3840x1648");
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
    await expect(customSize).toContainText("比例与尺寸（W × H）");
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
    await width.fill("1024"); await height.fill("1024"); await height.press("Tab");
    await expect.poll(savedParameters).toMatchObject({ tier: "4k", size_tier: "4K", size: "1024x1024", quality: "low" });
    await preset.selectOption("3840x1648");
    await expect.poll(savedParameters).toMatchObject({ tier: "4k", size: "3840x1648", quality: "low" });
    await tier.getByRole("button", { name: "自动", exact: true }).click();
    await expect.poll(savedParameters).toMatchObject({ tier: "web", size: "auto" });
    await expect(width).toHaveValue("");
    await expect(height).toHaveValue("");
    await expect(quality).toHaveCount(0);
    expect(submissions).toBe(0);
    await panel.screenshot({ path: testInfo.outputPath("cangyuan-current-parameters.png") });
  });
}
