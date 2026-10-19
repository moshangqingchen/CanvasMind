import { expect, test } from "./helpers/canvas-offline-test";
import { bindScannedModelProtocols } from "../lib/scanned-model-protocols";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";
import { chooseParameterOption, expectParameterValue, readParameterOptions } from "./helpers/parameter-controls";

for (const [baseUrl, modelGroup, id] of [
  ["https://token.secure-skill.com", "gpt-image-2.5", "gpt-image-2.5-flare"],
  ["https://platform.frimodel.com", "gpt_image_web", "gpt-image-2-w"],
  ["https://platform.frimodel.com", "gpt_image_web", "gpt-image-2.5"],
  ["https://platform.frimodel.com", "codex_image", "gpt-image-2-w"],
  ["https://platform.frimodel.com", "codex_image", "gpt-image-2.5"],
]) {
  test(`升级合同的 1K 下拉框显示、保存与恢复：${modelGroup} / ${id}`, async ({ page, request }, testInfo) => {
    const descriptor = bindScannedModelProtocols({ provider: "openai", config: { baseUrl, modelGroup } }, [{
      id: id!, name: "核查参数模型", operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true },
      parameters: [{ key: "size", label: "尺寸", control: "dimensions", default: "3840x2160", options: [{ label: "4K", value: "3840x2160" }] }],
    }]).models[0]!;
    const connectionResponse = await request.post("/api/providers", { data: { name: `核查隔离 ${modelGroup}`, provider: "rest",
      apiKey: "isolated-no-paid-generation", config: { baseUrl: "https://parameters.invalid", defaultModel: id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } } } });
    expect(connectionResponse.ok()).toBeTruthy();
    const connection = await connectionResponse.json();
    const canvasResponse = await request.post("/api/canvas", { data: { title: `升级参数隔离验收 ${crypto.randomUUID()}`, graph: {
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
    const options = await readParameterOptions(size);
    await size.click();
    const listId = await size.getAttribute("aria-controls");
    expect(listId).toBeTruthy();
    // The ratio label and tier detail are separate visible spans. Read the
    // detail itself so an adjacent ratio or an 11K label cannot satisfy 1K.
    const tierDetails = await page.locator(`[id=${JSON.stringify(listId)}]`).getByRole("option").evaluateAll(rows => rows.map(row => ({
      value: row.getAttribute("data-value"),
      tokens: (row.querySelector('[class*="optionDetail"]')?.textContent ?? "").split("·").map(token => token.trim()),
    })));
    await size.press("Escape");
    const unavailableAuto = options.filter(option => option.value === "__automatic_size_unavailable__");
    if (unavailableAuto.length) {
      expect(unavailableAuto).toHaveLength(1);
      expect(unavailableAuto[0]!.disabled).toBe(true);
      expect(unavailableAuto[0]!.label).toContain("当前渠道使用固定尺寸");
    }
    // The obsolete saved value stays visible until the user chooses a valid
    // size; all available contract options are scoped to 1K.
    for (const option of options.filter(option => !option.disabled && !["", "3840x2160", "auto"].includes(option.value))) {
      const matches = tierDetails.filter(detail => detail.value === option.value);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.tokens).toContain("1K");
    }
    if (baseUrl!.includes("frimodel")) {
      expect(tierDetails.filter(detail => detail.tokens.includes("1K"))).toHaveLength(11);
      await expect(panel.getByRole("button", { name: "2K", exact: true })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: "4K", exact: true })).toHaveCount(0);
    }
    await chooseParameterOption(size, "1536x1024");
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters.size).toBe("1536x1024");
    await page.reload();
    await open();
    await expectParameterValue(size, "1536x1024");
    expect(submitted).toBe(0);
    await size.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("one-k-group-controls.png") });
  });
}
