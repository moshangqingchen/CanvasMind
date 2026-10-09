import { expect, test } from "@playwright/test";
import { bindScannedModelProtocols } from "../lib/scanned-model-protocols";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

for (const [baseUrl, modelGroup, id] of [
  ["https://token.secure-skill.com", "gpt-image-2.5", "gpt-image-2.5-flare"],
  ["https://platform.frimodel.com", "gpt_image_web", "gpt-image-2-w"],
]) {
  test(`升级合同的 1K 下拉框显示、保存与恢复：${modelGroup}`, async ({ page, request }, testInfo) => {
    const descriptor = bindScannedModelProtocols({ provider: "openai", config: { baseUrl, modelGroup } }, [{
      id: id!, name: "核查参数模型", operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true },
      parameters: [{ key: "size", label: "尺寸", control: "dimensions", default: "3840x2160", options: [{ label: "4K", value: "3840x2160" }] }],
    }]).models[0]!;
    const connectionResponse = await request.post("/api/providers", { data: { name: `核查隔离 ${modelGroup}`, provider: "rest",
      apiKey: "isolated-no-paid-generation", config: { baseUrl: "https://parameters.invalid", defaultModel: id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } } } });
    expect(connectionResponse.ok()).toBeTruthy();
    const connection = await connectionResponse.json();
    const canvasResponse = await request.post("/api/canvas", { data: { title: "升级参数隔离验收", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow",
        position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: {
          nodeType: "image-generation", label: "核查参数", provider: "rest", connectionId: connection.id, model: id,
          parameters: { size: "3840x2160" }, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          outputs: [{ id: "images", kind: "image", label: "图片" }],
        } }],
    } } });
    expect(canvasResponse.ok()).toBeTruthy();
    const canvas = await canvasResponse.json();
    let submitted = 0;
    await page.route("**/api/runs", async route => {
      if (route.request().method() === "POST") { submitted++; await route.abort(); } else await route.continue();
    });
    await page.goto(`/canvas/${canvas.id}`);
    const open = () => page.getByRole("button", { name: "打开 核查参数 模型与参数", exact: true }).click();
    await open();
    const panel = page.getByRole("dialog", { name: "核查参数 模型与参数" });
    const size = panel.getByLabel("输出分辨率预设", { exact: true });
    const options = await size.locator("option").evaluateAll(items => items.map(item => ({
      label: item.textContent, value: (item as HTMLOptionElement).value,
    })));
    // The obsolete saved value stays visible until the user chooses a valid
    // size; all available contract options are scoped to 1K.
    expect(options.filter(option => !["", "3840x2160", "auto"].includes(option.value)).every(option => option.label?.startsWith("1K"))).toBe(true);
    await size.selectOption("1536x1024");
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters.size).toBe("1536x1024");
    await page.reload();
    await open();
    await expect(size).toHaveValue("1536x1024");
    expect(submitted).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("one-k-group-controls.png") });
  });
}
