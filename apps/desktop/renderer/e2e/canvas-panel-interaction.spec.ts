import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { attachedPanelGeometry } from "./attached-panel-geometry";

const models = [
  {
    id: "gpt-image-2",
    name: "图像模型甲",
    operations: ["image.generate"],
    inputKinds: ["text"],
    outputKinds: ["image"],
    metadata: { canvasRunnable: true },
  },
  {
    id: "gpt-image-2.5",
    name: "图像模型乙",
    operations: ["image.generate"],
    inputKinds: ["text"],
    outputKinds: ["image"],
    metadata: { canvasRunnable: true },
  },
];

async function openPanel(
  page: Page,
  request: APIRequestContext,
  modelDelay = 0,
) {
  const connections: { id: string; supplierKey: string; group: string }[] = [];
  for (const name of ["面板供应商甲", "面板供应商乙"]) {
    const response = await request.post("/api/suppliers", {
      data: {
        name,
        siteUrl: "https://panel.invalid",
        apiUrl: "https://panel.invalid",
      },
    });
    expect(response.ok()).toBeTruthy();
    const supplier = await response.json();
    for (const group of ["高质量", "标准"]) {
      const response = await request.post("/api/providers", {
        data: {
          name: `${name} · ${group}`,
          provider: "openai",
          apiKey: "isolated-panel-test",
          config: {
            supplierId: supplier.id,
            supplierKey: supplier.supplierKey,
            baseUrl: supplier.apiUrl,
            usage: "canvas",
            customGroup: true,
            modelGroup: group,
            defaultModel: "gpt-image-2",
          },
        },
      });
      expect(response.ok()).toBeTruthy();
      const connection = await response.json();
      connections.push({
        id: connection.id,
        supplierKey: supplier.supplierKey,
        group,
      });
      await page.route(
        `**/api/providers/${connection.id}/models*`,
        async (route) => {
          if (modelDelay)
            await new Promise((resolve) => setTimeout(resolve, modelDelay));
          await route.fulfill({
            json: models,
            headers: { "X-Model-Scan-Status": "live" },
          });
        },
      );
    }
  }
  // No test may submit a paid generation request, even if a click goes astray.
  let submitted = 0;
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() === "POST") {
      submitted++;
      await route.abort();
    } else await route.continue();
  });
  const response = await request.post("/api/canvas", {
    data: {
      title: "模型面板交互回归",
      graph: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        edges: [],
        nodes: [
          {
            id: "source",
            type: "workflow",
            position: { x: 55, y: 70 },
            style: { width: 420, height: 180 },
            data: {
              nodeType: "image-generation",
              label: "面板测试",
              provider: "openai",
              connectionId: connections[0]!.id,
              model: "gpt-image-2",
              parts: [],
              inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
              outputs: [{ id: "images", kind: "image", label: "图片" }],
              parameters: { quality: "high", n: 1 },
            },
          },
        ],
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  await page.goto(`/canvas/${canvas.id}`);
  const sidebar = page.getByRole("button", {
    name: "智能体面板",
    exact: true,
  });
  if ((await sidebar.getAttribute("aria-expanded")) === "true")
    await sidebar.click();
  await page
    .getByRole("button", { name: "打开 面板测试 模型与参数", exact: true })
    .click();
  const panel = page.getByRole("dialog", {
    name: "面板测试 模型与参数",
    exact: true,
  });
  await expect(panel).toBeVisible();
  return {
    connections,
    canvas,
    panel,
    supplier: panel.getByRole("combobox", {
      name: "面板测试 供应商",
      exact: true,
    }),
    group: panel.getByRole("combobox", {
      name: "面板测试 模型群组",
      exact: true,
    }),
    model: panel.getByRole("combobox", { name: "面板测试 模型", exact: true }),
    quantity: panel.getByRole("spinbutton", { name: "数量", exact: true }),
    assertNoRuns: () => expect(submitted).toBe(0),
  };
}

async function chooseWithMouse(
  page: Page,
  select: Locator,
  value: string,
  control = false,
) {
  if (control) await page.keyboard.down("Control");
  try {
    await select.click();
    await expect
      .poll(() => select.evaluate((element) => element.matches(":open")))
      .toBe(true);
  } finally {
    if (control) await page.keyboard.up("Control");
  }
  const index = await select
    .locator("option")
    .evaluateAll(
      (options, target) =>
        options.findIndex(
          (option) => (option as HTMLOptionElement).value === target,
        ),
      value,
    );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Home");
  for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue(value);
}

test("按住画布框选键切换供应商与模型后，面板仍可编辑和关闭", async ({
  page,
  request,
}) => {
  const ui = await openPanel(page, request);
  await chooseWithMouse(
    page,
    ui.supplier,
    ui.connections[2]!.supplierKey,
    true,
  );
  await chooseWithMouse(page, ui.group, "标准", true);
  await page.keyboard.down("Control");
  try {
    await ui.model.click();
    await ui.panel
      .getByRole("option", { name: "图像模型乙", exact: true })
      .click();
    await expect(ui.model).toHaveAttribute("aria-expanded", "false");
    await ui.quantity.click();
    await expect(ui.quantity).toBeFocused();
  } finally {
    await page.keyboard.up("Control");
  }
  await ui.quantity.fill("2");
  await expect(ui.quantity).toHaveValue("2");
  await page.keyboard.down("Control");
  try {
    await ui.panel.getByRole("button", { name: "关闭模型与参数面板" }).click();
    await expect(ui.panel).toBeHidden();
  } finally {
    await page.keyboard.up("Control");
  }
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/canvas/${ui.canvas.id}`)).json()).graph
          .nodes[0].data.parameters.n,
    )
    .toBe(2);
  ui.assertNoRuns();
});

test("点击模型列表外的供应商输入会收起模型菜单并保留输入焦点", async ({
  page,
  request,
}) => {
  const ui = await openPanel(page, request);
  await ui.model.click();
  await expect(ui.panel.getByRole("listbox")).toBeVisible();
  // Search, model IDs and prices make the menu taller than the old name-only
  // list. The quantity field can be covered; the supplier stays outside it.
  await ui.supplier.click();
  await expect(ui.model).toHaveAttribute("aria-expanded", "false");
  await expect(ui.supplier).toBeFocused();
  await page.keyboard.press("Escape");
  await ui.quantity.click();
  await expect(ui.quantity).toBeFocused();
  await ui.quantity.fill("3");
  await expect(ui.quantity).toHaveValue("3");
  ui.assertNoRuns();
});

test("异步模型目录返回后反复切换供应商与群组仍可编辑参数", async ({
  page,
  request,
}) => {
  const ui = await openPanel(page, request, 600);
  for (const index of [2, 0, 2]) {
    await chooseWithMouse(
      page,
      ui.supplier,
      ui.connections[index]!.supplierKey,
    );
    await chooseWithMouse(page, ui.group, "标准");
    await ui.model.click();
    await expect(ui.model).toHaveAttribute("aria-expanded", "true");
    // Open before the delayed catalog arrives. Filling the automatic model
    // must keep this menu open so the user's next click still has a target.
    const option = ui.panel.getByRole("option", {
      name: "图像模型乙",
      exact: true,
    });
    await expect(option).toBeVisible();
    await expect(ui.model).toHaveAttribute("aria-expanded", "true");
    await option.click();
    await expect(ui.model).toHaveAttribute("aria-expanded", "false");
  }
  await ui.quantity.click();
  await expect(ui.quantity).toBeFocused();
  await ui.quantity.fill("2");
  await ui.panel.getByRole("button", { name: "关闭模型与参数面板" }).click();
  await expect(ui.panel).toBeHidden();
  await page
    .getByRole("button", { name: "打开 面板测试 模型与参数", exact: true })
    .click();
  await expect(ui.quantity).toHaveValue("2");
  await expect(ui.supplier).toHaveValue(ui.connections[2]!.supplierKey);
  await expect(ui.group).toHaveValue("标准");
  ui.assertNoRuns();
});

test("空间充足时参数面板随节点平移与拖动，节点离屏后面板保持可操作", async ({ page, request }) => {
  // Keep space for the full scaled panel and drag path. Narrow/clamped windows
  // are covered separately; an overlapping panel must not receive node drags.
  await page.setViewportSize({ width: 1440, height: 1600 });
  const ui = await openPanel(page, request);
  await page.getByRole("button", { name: "抓手模式", exact: true }).click();
  const node = page.locator('.react-flow__node[data-id="source"] .node-card');
  const geometry = () => ui.panel.evaluate(element => {
    const node = document.querySelector('.react-flow__node[data-id="source"]')!;
    const card = node.querySelector(".node-card")!.getBoundingClientRect();
    const panel = element.getBoundingClientRect();
    const viewport = document.querySelector(".react-flow__viewport")!;
    const transform = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    const position = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return {
      nodeX: card.x,
      nodeY: card.y,
      panelX: panel.x,
      panelY: panel.y,
      worldX: position.m41,
      worldY: position.m42,
      zoom: transform.a,
    };
  });
  const assertAttached = () => expect.poll(async () => (await attachedPanelGeometry(ui.panel)).attachmentError).toBeLessThanOrEqual(1);

  await page.locator(".react-flow__controls-zoomout").click();
  await expect.poll(async () => (await geometry()).zoom).toBeLessThan(1);
  await assertAttached();

  const beforePan = await geometry();
  const pane = await page.locator(".react-flow__pane").boundingBox();
  expect(pane).not.toBeNull();
  const panStart = { x: pane!.x + pane!.width - 260, y: pane!.y + 100 };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  try {
    await page.mouse.move(panStart.x + 100, panStart.y + 40, { steps: 12 });
    await expect.poll(async () => (await geometry()).nodeX).toBeCloseTo(beforePan.nodeX + 100, 0);
    await expect.poll(async () => (await geometry()).nodeY).toBeCloseTo(beforePan.nodeY + 40, 0);
    // Check while the pointer is still down, not just after the gesture settles.
    await assertAttached();
  } finally {
    await page.mouse.up();
  }
  const afterPan = await geometry();
  expect((await attachedPanelGeometry(ui.panel)).direction).toBe("below");
  expect(afterPan.worldX).toBe(beforePan.worldX);
  expect(afterPan.worldY).toBe(beforePan.worldY);

  const header = await node.locator(".node-head").boundingBox();
  expect(header).not.toBeNull();
  const dragStart = { x: header!.x + header!.width / 2, y: header!.y + header!.height / 2 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  try {
    await page.mouse.move(dragStart.x + 120, dragStart.y + 50, { steps: 12 });
    // React Flow begins movement after its drag threshold, so the node need
    // not travel the pointer's full distance. Its panel must travel with it.
    await expect.poll(async () => (await geometry()).nodeX - afterPan.nodeX).toBeGreaterThan(80);
    await expect.poll(async () => (await geometry()).nodeY - afterPan.nodeY).toBeGreaterThan(25);
    const dragged = await geometry();
    expect((await attachedPanelGeometry(ui.panel)).direction).toBe("below");
    const deltaX = dragged.nodeX - afterPan.nodeX;
    const deltaY = dragged.nodeY - afterPan.nodeY;
    expect(dragged.panelX - afterPan.panelX).toBeCloseTo(deltaX, 0);
    expect(dragged.panelY - afterPan.panelY).toBeCloseTo(deltaY, 0);
    expect((dragged.worldX - afterPan.worldX) * dragged.zoom).toBeCloseTo(deltaX, 0);
    expect((dragged.worldY - afterPan.worldY) * dragged.zoom).toBeCloseTo(deltaY, 0);
    await assertAttached();
  } finally {
    await page.mouse.up();
  }
  await expect.poll(async () => (await geometry()).worldX).toBeGreaterThan(afterPan.worldX);
  await assertAttached();

  // A user must be able to pan upward to reach the lower controls. The node
  // itself leaves the viewport before its attached panel does; virtualization
  // must not unmount that still-visible panel.
  const card = await node.boundingBox();
  expect(card).not.toBeNull();
  const current = await geometry();
  const upwardPan = pane!.y - (card!.y + card!.height) - 4 * current.zoom;
  const offscreenPanStart = { x: panStart.x, y: pane!.y + pane!.height - 180 };
  await page.mouse.move(offscreenPanStart.x, offscreenPanStart.y);
  await page.mouse.down();
  try {
    await page.mouse.move(offscreenPanStart.x, offscreenPanStart.y + upwardPan, { steps: 20 });
    await expect(ui.panel).toBeVisible();
    await expect.poll(() => node.evaluate(element => {
      const canvas = document.querySelector(".react-flow__pane")!.getBoundingClientRect();
      return element.getBoundingClientRect().bottom - canvas.top;
    })).toBeLessThan(0);
    await assertAttached();
  } finally {
    await page.mouse.up();
  }
  await ui.quantity.fill("2");
  await expect(ui.quantity).toHaveValue("2");
  await ui.panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click({ trial: true });
  // Clamping keeps the header accessible while the node is offscreen. Escape
  // must still close the panel and restore normal culling.
  await page.keyboard.press("Escape");
  await expect(ui.panel).toBeHidden();
  ui.assertNoRuns();
});
