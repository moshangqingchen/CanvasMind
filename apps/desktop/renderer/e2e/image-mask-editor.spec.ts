import { expect, test, type Locator } from "@playwright/test";
import sharp from "sharp";

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "蒙版测试只能使用 globalSetup 创建的隔离数据目录").toBeFalsy();
});

async function expectUsableMaskLayout(node: Locator) {
  await expect.poll(async () => node.evaluate(element => {
    const card = element.querySelector<HTMLElement>(".node-card")!;
    const status = element.querySelector<HTMLElement>(".node-mask-summary")!;
    const prompt = element.querySelector<HTMLElement>(".tiptap-prompt")!;
    const toolbar = element.querySelector<HTMLElement>(".node-inline-toolbar")!;
    const bounds = card.getBoundingClientRect();
    const statusBounds = status.getBoundingClientRect();
    const promptBounds = prompt.getBoundingClientRect();
    const toolbarBounds = toolbar.getBoundingClientRect();
    return element.clientHeight >= 330 && prompt.clientHeight >= 46 &&
      statusBounds.bottom <= promptBounds.top + 1 && promptBounds.bottom <= toolbarBounds.top + 1 &&
      toolbarBounds.bottom <= bounds.bottom + 1 && statusBounds.left >= bounds.left &&
      statusBounds.right <= bounds.right && toolbarBounds.right <= bounds.right;
  })).toBe(true);
}

for (const sourceKind of ["uploaded", "generated"] as const) {
  test(`蒙版画笔：${sourceKind} 原图、缩放、擦除、撤销、保存与重开`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const bytes = await sharp({ create: { width: 1024, height: 768, channels: 4, background: "#698bce" } }).png().toBuffer();
    const uploaded = await request.post(`/api/assets/upload?name=${sourceKind}.png`, { headers: { "content-type": "image/png" }, data: bytes });
    expect(uploaded.status()).toBe(201);
    const asset = await uploaded.json();
    const response = await request.post("/api/canvas", { data: {
      title: `蒙版验收 ${sourceKind}`, graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "source", type: "workflow", position: { x: 160, y: 140 }, style: { width: 420, height: 360 },
        data: { nodeType: "asset-input", label: "蒙版原图", assetId: asset.id, assetKind: "image",
          outputs: [{ id: "asset", kind: "image", label: "图片" }],
          ...(sourceKind === "generated" ? { generatedResult: true, generatedStatus: "succeeded", generatedProvider: "openai",
            generatedModel: "gpt-image-2", generatedParameters: {}, generatedPromptParts: [{ type: "text", text: "测试历史原图" }] } : {}),
        },
      }] },
    } });
    expect(response.ok()).toBeTruthy();
    const project = await response.json();
    let submitted = 0;
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route("**/api/runs", route => {
      if (route.request().method() === "POST") { submitted += 1; return route.abort(); }
      return route.continue();
    });
    await page.goto(`/canvas/${project.id}`);
    const source = page.locator('.react-flow__node[data-id="source"]');
    await source.locator(sourceKind === "generated" ? ".generated-result-viewport" : ".asset-node-preview").click();
    await page.getByRole("button", { name: "绘制蒙版", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "涂抹重绘区域" });
    const canvas = editor.locator('canvas[aria-label="在原图上涂抹需要重绘的区域"]');
    const save = editor.getByRole("button", { name: "保存并创建局部重绘", exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("button", { name: "画笔", exact: true })).toBeEnabled();
    await expect(save).toBeDisabled();
    expect(await canvas.evaluate((element: HTMLCanvasElement) => [element.width, element.height])).toEqual([1024, 768]);
    await editor.getByRole("button", { name: "缩小预览", exact: true }).click();
    const bounds = (await canvas.boundingBox())!;
    const position = (x: number, y: number) => ({ x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y });
    const start = position(.25, .5), end = position(.75, .5), center = position(.5, .5);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await expect(save).toBeEnabled();
    const alpha = (x: number, y: number) => canvas.evaluate((element: HTMLCanvasElement, point) =>
      element.getContext("2d")!.getImageData(point.x, point.y, 1, 1).data[3], { x, y });
    expect(await alpha(512, 384)).toBe(255);
    expect(await alpha(50, 50)).toBe(0);
    await editor.getByRole("button", { name: "橡皮", exact: true }).click();
    await page.mouse.click(center.x, center.y);
    expect(await alpha(512, 384)).toBe(0);
    await editor.getByRole("button", { name: "撤销涂抹", exact: true }).click();
    expect(await alpha(512, 384)).toBe(255);
    await editor.getByRole("button", { name: "重做涂抹", exact: true }).click();
    expect(await alpha(512, 384)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`${sourceKind}-mask-brush.png`) });
    await save.click();
    await expect(editor).toHaveCount(0);
    const graph = async () => (await (await request.get(`/api/canvas/${project.id}`)).json()).graph;
    await expect.poll(async () => (await graph()).nodes.find((node: { data: { label: string } }) => node.data.label === "局部重绘")?.data.parameters.maskSourceAssetId).toBe(asset.id);
    const edit = (await graph()).nodes.find((node: { data: { label: string } }) => node.data.label === "局部重绘");
    const editNode = page.locator(`.react-flow__node[data-id="${edit.id}"]`);
    const prompt = editNode.getByRole("textbox", { name: "编辑 局部重绘 提示词", exact: true });
    await expect(prompt).toHaveAttribute("data-placeholder", "描述涂抹区域要如何修改，例如：将衣服改成蓝色…");
    await expect(prompt).toHaveAttribute("data-empty", "true");
    expect(edit.data.parts).toEqual([{ type: "text", text: "" }]);
    await expectUsableMaskLayout(editNode);
    await expect(editNode.getByRole("button", { name: "运行 局部重绘 节点", exact: true })).toBeDisabled();
    await prompt.fill("仅将涂抹区域改为蓝色");
    await expect(prompt).toHaveAttribute("data-empty", "false");
    await prompt.press("Control+Enter");
    await prompt.press("Control+Shift+Enter");
    expect(submitted).toBe(0);
    await expect.poll(async () => (await graph()).nodes.find((node: { id: string }) => node.id === edit.id).data.parts)
      .toEqual([{ type: "text", text: "仅将涂抹区域改为蓝色" }]);
    await prompt.press("Control+A");
    await prompt.press("Backspace");
    await expect(prompt).toHaveAttribute("data-empty", "true");
    await editNode.getByRole("button", { name: "选择可编辑模型", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "局部重绘 模型与参数", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await graph()).nodes.find((node: { id: string }) => node.id === edit.id).data.parts)
      .toEqual([{ type: "text", text: "" }]);
    await editNode.screenshot({ path: testInfo.outputPath(`${sourceKind}-mask-node.png`) });
    const maskId = edit.data.parameters.maskAssetId;
    const maskResponse = await request.get(`/api/assets/${maskId}/content`);
    const pixels = await sharp(await maskResponse.body()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([pixels.info.width, pixels.info.height, pixels.info.channels]).toEqual([1024, 768, 4]);
    const savedAlpha = (x: number, y: number) => pixels.data[(y * 1024 + x) * 4 + 3];
    expect(savedAlpha(350, 384)).toBe(0);
    expect(savedAlpha(512, 384)).toBe(255);
    expect(savedAlpha(50, 50)).toBe(255);
    expect(await (await request.get(`/api/assets/${asset.id}/content`)).body()).toEqual(bytes);
    await page.reload();
    await expectUsableMaskLayout(editNode);
    await editNode.getByRole("button", { name: "编辑蒙版", exact: true }).click();
    await expect(editor.getByRole("button", { name: "保存蒙版", exact: true })).toBeEnabled();
    expect(await alpha(350, 384)).toBe(255);
    expect(await alpha(512, 384)).toBe(0);
    await editor.getByRole("button", { name: "清空", exact: true }).click();
    await expect(editor.getByRole("button", { name: "保存蒙版", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "关闭蒙版编辑器", exact: true }).click();
    await expect(editor.getByRole("button", { name: "继续编辑", exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "放弃修改", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await graph()).nodes.find((node: { id: string }) => node.id === edit.id).data.parameters.maskAssetId).toBe(maskId);
    await editNode.getByRole("button", { name: "移除蒙版", exact: true }).click();
    await expect.poll(async () => (await graph()).nodes.find((node: { id: string }) => node.id === edit.id).data.parameters.maskAssetId).toBeUndefined();
    expect(submitted).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}

test("窄旧节点恢复尺寸，断开原图禁止运行且仍能移除旧 URL 蒙版", async ({ page, request }, testInfo) => {
  const response = await request.post("/api/canvas", { data: { title: "旧蒙版移除", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "edit", type: "workflow",
      position: { x: 160, y: 140 }, style: { width: 300, height: 150 }, data: { nodeType: "image-generation", label: "旧蒙版", provider: "fake",
        connectionId: "fake-default", model: "fake-image-v1", parameters: { mask: "https://example.invalid/mask.png" },
        parts: [], inputs: [], outputs: [{ id: "images", kind: "image" }] },
    }],
  } } });
  const project = await response.json();
  let submitted = 0;
  await page.route("**/api/runs", route => {
    if (route.request().method() === "POST") { submitted++; return route.abort(); }
    return route.continue();
  });
  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByText("请连接蒙版对应的原图", { exact: true })).toBeVisible();
  const editNode = page.locator('.react-flow__node[data-id="edit"]');
  await expectUsableMaskLayout(editNode);
  await expect(editNode.getByRole("button", { name: "运行 旧蒙版 节点", exact: true })).toBeDisabled();
  const prompt = editNode.getByRole("textbox", { name: "编辑 旧蒙版 提示词", exact: true });
  await prompt.fill("保留原图其余区域");
  await prompt.press("Control+Enter");
  await prompt.press("Control+Shift+Enter");
  await editNode.screenshot({ path: testInfo.outputPath("narrow-missing-original.png") });
  await page.getByRole("button", { name: "移除蒙版", exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/canvas/${project.id}`)).json()).graph.nodes[0].data.parameters.mask).toBeUndefined();
  expect(submitted).toBe(0);
});
