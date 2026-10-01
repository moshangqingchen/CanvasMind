import { expect, test } from "@playwright/test";
import { cangyuanCurrentModel } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const ratios = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"];

for (const id of ["gpt-image-2-x", "gpt-image-2.5-x"]) {
  test(`${id} 原生计费档、全部比例和手选质量保存恢复`, async ({ page, request }, testInfo) => {
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
    const tier = panel.getByLabel("清晰度 / 计费档位", { exact: true });
    const ratio = panel.getByLabel("画面比例", { exact: true });
    const quality = panel.getByLabel("质量", { exact: true });
    await expect(quality).toHaveValue("max");
    const expectedQualities = id === "gpt-image-2.5-x" ? ["auto", "low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high", "xhigh", "max"];
    expect(await quality.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value).filter(Boolean))).toEqual(expectedQualities);
    for (const value of ["1k", "2k", "4k"]) {
      await tier.selectOption(value);
      expect(await ratio.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value).filter(Boolean))).toEqual(expect.arrayContaining(ratios));
      await ratio.selectOption("9:21");
      await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
        .toMatchObject({ tier: value, aspect_ratio: "9:21", quality: "max" });
    }
    await quality.selectOption("low");
    if (id === "gpt-image-2.5-x") await panel.getByLabel("产品线", { exact: true }).selectOption("flare");
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
      .toMatchObject({ tier: "4k", aspect_ratio: "9:21", quality: "low", ...(id === "gpt-image-2.5-x" ? { series: "flare" } : {}) });
    await page.reload(); await open();
    await expect(tier).toHaveValue("4k");
    await expect(ratio).toHaveValue("9:21");
    await expect(quality).toHaveValue("low");
    if (id === "gpt-image-2.5-x") await expect(panel.getByLabel("产品线", { exact: true })).toHaveValue("flare");
    expect(submissions).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("cangyuan-current-parameters.png") });
  });
}
