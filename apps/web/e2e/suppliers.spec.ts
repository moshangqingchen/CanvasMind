import { expect, test, type Page } from "@playwright/test";
import type { ProviderConnectionView } from "../lib/client-api";
import type { SupplierRecord } from "../lib/client-suppliers";

function fixtureSupplier(): SupplierRecord {
  return {
    id: "supplier-fixture",
    name: "测试供应商",
    supplierKey: "custom-fixture",
    siteUrl: "https://fixture.example.com",
    apiUrl: "https://fixture.example.com/v1",
    kind: "newapi",
    catalog: {
      groups: [
        {
          id: "vip",
          label: "VIP 创作组",
          source: "catalog",
          models: [
            {
              id: "catalog-image",
              capability: "image",
              protocol: "openai-images",
            },
          ],
        },
      ],
    },
    scanStatus: "live",
    scannedAt: "2026-09-08T03:00:00.000Z",
    createdAt: "2026-09-08T03:00:00.000Z",
    updatedAt: "2026-09-08T03:00:00.000Z",
  };
}

async function mockSuppliers(
  page: Page,
  options: {
    existing?: boolean;
    stale?: boolean;
    restVideo?: boolean;
    groupCount?: number;
  } = {},
) {
  let suppliers = options.existing ? [fixtureSupplier()] : [];
  if (options.groupCount && suppliers[0]) {
    const initialGroup = suppliers[0].catalog.groups[0]!;
    suppliers[0].catalog.groups = [
      initialGroup,
      ...Array.from({ length: options.groupCount - 1 }, (_, index) => ({
        ...initialGroup,
        id: `group-${index + 2}`,
        label: `创作分组 ${index + 2}`,
      })),
    ];
  }
  let connections: ProviderConnectionView[] = options.existing
    ? [
        {
          id: "connection-fixture",
          name: "测试供应商 · vip · 画布",
          provider: options.restVideo ? "rest" : "openai",
          apiKeySet: true,
          apiKey: "",
          config: {
            supplierId: "supplier-fixture",
            supplierKey: "custom-fixture",
            modelGroup: "vip",
            usage: "canvas",
            baseUrl: "https://fixture.example.com/v1",
            customGroup: true,
            modelScanStatus: "live",
            scannedModelIds: ["scanned-image"],
            ...(options.restVideo
              ? {
                  connector: {
                    models: [
                      {
                        id: "configured-video",
                        name: "Configured Video",
                        operations: ["video.generate"],
                      },
                    ],
                  },
                }
              : {}),
          },
        },
      ]
    : [];
  const writes: Array<{
    id?: string;
    apiKey?: string;
    config: Record<string, unknown>;
    provider: string;
    name: string;
  }> = [];
  await page.route("**/api/suppliers**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = method === "GET" ? {} : route.request().postDataJSON();
    if (method === "DELETE" && url.pathname.endsWith("/groups")) {
      suppliers = suppliers.map((supplier) => ({
        ...supplier,
        catalog: {
          groups: supplier.catalog.groups.filter(
            (group) => group.id !== body.groupId,
          ),
        },
      }));
      connections = connections.filter(
        (connection) => connection.config.modelGroup !== body.groupId,
      );
      await route.fulfill({ json: suppliers[0] });
      return;
    }
    if (url.pathname.endsWith("/scan")) {
      const current = suppliers[0]!;
      if (options.groupCount) {
        await route.fulfill({
          json: {
            ...current,
            scannedAt: new Date().toISOString(),
            scanStatus: "live",
          },
        });
        return;
      }
      suppliers = [
        {
          ...current,
          scanStatus: "empty",
          scannedAt: new Date().toISOString(),
          catalog: {
            groups: current.catalog.groups.filter(
              (group) => group.source === "manual",
            ),
          },
          scanError: "没有发现公开分组，可以手动添加。",
        },
      ];
      await route.fulfill({ json: suppliers[0] });
      return;
    }
    if (method === "POST") {
      suppliers = [
        {
          ...fixtureSupplier(),
          ...body,
          id: "supplier-fixture",
          supplierKey: "custom-fixture",
          catalog: { groups: [] },
          scanStatus: "unscanned",
        },
      ];
      await route.fulfill({ status: 201, json: suppliers[0] });
      return;
    }
    if (method === "PATCH") {
      const current = suppliers[0]!;
      const catalog = body.catalog
        ? { groups: [...current.catalog.groups, ...body.catalog.groups] }
        : current.catalog;
      const { siteLogin, ...patch } = body;
      suppliers = [
        {
          ...current,
          ...patch,
          catalog,
          ...(siteLogin === null
            ? { siteLogin: undefined }
            : siteLogin
              ? {
                  siteLogin: { username: siteLogin.username, configured: true },
                }
              : {}),
        },
      ];
      await route.fulfill({ json: suppliers[0] });
      return;
    }
    await route.fulfill({ json: suppliers });
  });
  await page.route("**/api/providers**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/models")) {
      const isRefresh = url.searchParams.get("refresh") === "1";
      const existingModels = options.existing
        ? [
            {
              id: "scanned-image",
              name: "Scanned Image",
              operations: ["image.generate"],
            },
          ]
        : [];
      await route.fulfill({
        json: existingModels,
        headers: {
          "X-Model-Scan-Status":
            options.stale && isRefresh
              ? "stale"
              : options.existing
                ? "live"
                : "empty",
        },
      });
      return;
    }
    if (url.pathname.endsWith("/test")) {
      await route.fulfill({ json: { message: "连接测试成功" } });
      return;
    }
    if (
      url.pathname === "/api/providers" &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON();
      writes.push(body);
      const saved = {
        ...body,
        id: body.id || `connection-${writes.length}`,
        apiKeySet: true,
        apiKey: "",
      };
      connections = [
        ...connections.filter((connection) => connection.id !== saved.id),
        saved,
      ];
      await route.fulfill({ json: saved });
      return;
    }
    if (url.pathname === "/api/providers") {
      await route.fulfill({ json: connections });
      return;
    }
    await route.fulfill({ json: { groups: [], source: "unavailable" } });
  });
  return { writes, suppliers: () => suppliers, connections: () => connections };
}

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "供应商与模型设置" }),
  ).toBeVisible();
}

test("平台没有返回的旧连接分组归入手动分组，不依赖手动标记且可删除", async ({
  page,
}) => {
  const api = await mockSuppliers(page, { existing: true });
  api
    .connections()
    .push({
      ...api.connections()[0]!,
      id: "legacy-local",
      name: "OpenAI 图片",
      config: {
        ...api.connections()[0]!.config,
        modelGroup: "OpenAI 图片",
        customGroup: false,
      },
    });
  api
    .suppliers()[0]!
    .catalog.groups.push({
      id: "absent",
      label: "Absent",
      source: "catalog",
      status: "missing",
      models: [],
    });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const platform = dialog.getByRole("region", {
    name: "供应商分组",
    exact: true,
  });
  const manual = dialog.getByRole("region", { name: "手动分组", exact: true });
  await expect(
    platform.getByRole("heading", { name: "vip", exact: true }),
  ).toBeVisible();
  await expect(platform.locator(".sm-group-card")).toHaveCount(1);
  await expect(
    manual.getByRole("heading", { name: "OpenAI 图片", exact: true }),
  ).toBeVisible();
  await expect(
    manual.getByRole("heading", { name: "absent", exact: true }),
  ).toBeVisible();
  await manual
    .getByRole("button", { name: "删除手动分组 OpenAI 图片", exact: true })
    .click();
  await expect(
    manual.getByRole("heading", { name: "OpenAI 图片", exact: true }),
  ).toHaveCount(0);
  expect(
    api.connections().some((connection) => connection.id === "legacy-local"),
  ).toBe(false);
  await expect(platform.locator(".sm-group-card")).toHaveCount(1);
});

test("供应商分组和手动分组可独立收起，手动分组删除后刷新不再出现", async ({
  page,
}) => {
  const api = await mockSuppliers(page, { existing: true });
  api.suppliers()[0]!.catalog.groups.push({
    id: "my-manual",
    label: "my-manual",
    source: "manual",
    models: [],
  });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const platform = dialog.getByRole("region", {
    name: "供应商分组",
    exact: true,
  });
  const manual = dialog.getByRole("region", { name: "手动分组", exact: true });
  await expect(
    platform.getByRole("heading", { name: "vip", exact: true }),
  ).toBeVisible();
  await expect(
    manual.getByRole("heading", { name: "my-manual", exact: true }),
  ).toBeVisible();
  await expect(
    platform.getByRole("button", { name: /删除手动分组/u }),
  ).toHaveCount(0);
  const platformToggle = platform.getByRole("button", { name: /供应商分组/u });
  await platformToggle.click();
  await expect(platformToggle).toHaveAttribute("aria-expanded", "false");
  await expect(platform.locator(".sm-group-card")).toBeHidden();
  await expect(manual.locator(".sm-group-card")).toBeVisible();
  const manualToggle = manual.getByRole("button", { name: /^手动分组/u });
  await manualToggle.click();
  await expect(manual.locator(".sm-group-card")).toBeHidden();
  await platformToggle.click();
  await expect(platform.locator(".sm-group-card")).toBeVisible();
  await manualToggle.click();
  await manual
    .getByRole("button", { name: "删除手动分组 my-manual", exact: true })
    .click();
  await expect(manual.locator(".sm-group-card")).toHaveCount(0);
  await expect(platform.locator(".sm-group-card")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "my-manual", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("heading", { name: "vip", exact: true }),
  ).toBeVisible();
});

test("站点账号密码保存后自动用于扫描，留空保留密码并支持清除", async ({
  page,
}) => {
  await mockSuppliers(page, { existing: true, groupCount: 2 });
  const requests: Array<{
    method: string;
    path: string;
    body: Record<string, unknown>;
  }> = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/suppliers") && request.method() !== "GET")
      requests.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: request.postDataJSON(),
      });
  });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByLabel("站点账号", { exact: true }).fill("user@example.com");
  await dialog.getByLabel("站点密码", { exact: true }).fill(" keep spaces ");
  await dialog.getByRole("button", { name: "保存并扫描", exact: true }).click();
  await expect(dialog.getByPlaceholder("已保存，留空保持原密码")).toHaveValue(
    "",
  );
  await expect(
    dialog.getByText("已识别 2 个分组。", { exact: false }),
  ).toBeVisible();
  expect(
    requests.find((request) => request.method === "PATCH")?.body.siteLogin,
  ).toEqual({ username: "user@example.com", password: " keep spaces " });
  expect(
    requests.find((request) => request.path.endsWith("/scan"))?.body,
  ).not.toHaveProperty("siteLogin");
  requests.length = 0;
  await dialog.getByRole("button", { name: "保存并扫描", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "保存并扫描", exact: true }),
  ).toBeEnabled();
  expect(
    requests.find((request) => request.method === "PATCH")?.body,
  ).not.toHaveProperty("siteLogin");
  await dialog
    .getByRole("button", { name: "清除已保存登录", exact: true })
    .click();
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByPlaceholder("请输入站点登录密码")).toHaveValue("");
  expect(
    requests.filter((request) => request.method === "PATCH").at(-1)?.body
      .siteLogin,
  ).toBeNull();
  await expect(dialog.getByLabel("站点账号", { exact: true })).toHaveValue("");
});

test("分组搜索无匹配时可显示全部，重新扫描不会被旧筛选隐藏", async ({
  page,
}) => {
  await mockSuppliers(page, { existing: true, groupCount: 14 });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const cards = dialog.locator(".sm-group-card");
  const search = dialog.getByRole("searchbox", { name: "查找分组或模型" });
  await expect(cards).toHaveCount(14);
  await search.fill("canvas");
  // Password-manager input must never apply a filter on its own.
  await expect(cards).toHaveCount(14);
  await search.press("Enter");
  await expect(cards).toHaveCount(0);
  await expect(dialog.getByText("显示 0 / 14 个分组")).toBeVisible();
  await expect(
    dialog.getByText("已有 14 个分组，当前搜索条件隐藏了它们。"),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "显示全部分组", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(cards).toHaveCount(14);
  await search.fill(" VIP ");
  await dialog.getByRole("button", { name: "查找", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await dialog.getByRole("button", { name: "清除分组筛选" }).click();
  await expect(cards).toHaveCount(14);
  await search.fill("canvas");
  await search.press("Enter");
  await dialog.getByRole("button", { name: "保存并扫描", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(cards).toHaveCount(14);
});

test("浏览器后台填入登录用户名不会隐藏分组或阻止刷新模型", async ({ page }) => {
  await mockSuppliers(page, { existing: true, groupCount: 14 });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const search = dialog.getByRole("searchbox", { name: "查找分组或模型" });
  await search.evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "canvas");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(search).toHaveValue("canvas");
  await expect(dialog.locator(".sm-group-card")).toHaveCount(14);
  expect(
    await search.evaluate(
      (element) =>
        (element as HTMLInputElement).form?.querySelectorAll(
          'input[type="password"]',
        ).length,
    ),
  ).toBe(0);
  const group = dialog
    .locator(".sm-group-card")
    .filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await expect(
    group.getByLabel("vip 画布 API Key", { exact: true }),
  ).toHaveAttribute("autocomplete", "new-password");
  await group.getByRole("button", { name: "刷新模型", exact: true }).click();
  await expect(
    group.getByText("已读取 1 个模型。", { exact: true }),
  ).toBeVisible();
  await expect(
    group.locator("code").filter({ hasText: "scanned-image" }),
  ).toBeVisible();
  await expect(dialog.locator(".sm-group-card")).toHaveCount(14);
});

test("切换同协议的不同站点会重置分组筛选和地址表单", async ({ page }) => {
  const api = await mockSuppliers(page, { existing: true, groupCount: 5 });
  const gateways = ["A", "B"].map((suffix) => ({
    ...api.suppliers()[0]!,
    id: `gateway-${suffix}`,
    name: `网关 ${suffix}`,
    supplierKey: "openai",
    siteUrl: `https://gateway-${suffix.toLowerCase()}.example.com`,
    apiUrl: `https://gateway-${suffix.toLowerCase()}.example.com/v1`,
  }));
  await page.route("**/api/suppliers", (route) =>
    route.fulfill({ json: gateways }),
  );
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog
    .getByRole("searchbox", { name: "查找分组或模型" })
    .fill("canvas");
  await dialog
    .locator(".sm-supplier-item")
    .filter({ hasText: "网关 B" })
    .click();
  await expect(dialog.getByLabel("站点地址", { exact: true })).toHaveValue(
    gateways[1]!.siteUrl,
  );
  await expect(dialog.getByLabel("供应商名称", { exact: true })).toHaveValue(
    "网关 B",
  );
  await expect(
    dialog.getByRole("searchbox", { name: "查找分组或模型" }),
  ).toHaveValue("");
  await expect(dialog.locator(".sm-group-card")).toHaveCount(5);
});

test("供应商可从地址扫描失败转手动分组，并保持画布和智能体 Key 独立", async ({
  page,
}) => {
  const api = await mockSuppliers(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("button", { name: "添加供应商", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: /供应商名称/ })
    .fill("我的自定义站点");
  await dialog
    .getByRole("textbox", { name: /^站点地址/ })
    .fill("https://fixture.example.com");
  await dialog.getByRole("button", { name: "添加并扫描", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "这个站点没有公开分组目录" }),
  ).toBeVisible();
  await expect(dialog.getByPlaceholder("用户名或邮箱")).toBeVisible();
  await expect(dialog.getByPlaceholder("请输入站点登录密码")).toBeVisible();
  await dialog
    .getByRole("button", { name: "手动添加分组", exact: true })
    .first()
    .click();
  await dialog
    .getByRole("textbox", { name: "分组名称", exact: true })
    .fill("private-vip");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  const group = dialog.locator(".sm-group-card").filter({
    has: page.getByRole("heading", { name: "private-vip", exact: true }),
  });
  await expect(group.getByText("手动分组", { exact: true })).toBeVisible();
  await group
    .getByLabel("private-vip 画布 API Key", { exact: true })
    .fill("fixture-canvas-key");
  await group.getByRole("button", { name: "测试并读取", exact: true }).click();
  await expect(
    group.getByText("Key 模型列表读取成功，返回 0 个模型。", { exact: true }),
  ).toBeVisible();
  await group
    .getByRole("button", { name: "手动添加模型", exact: true })
    .click();
  await group
    .getByRole("textbox", { name: "准确模型 ID", exact: true })
    .fill("models/My-Exact-Image");
  await group
    .getByRole("button", { name: "保存为未验证模型", exact: true })
    .click();
  await expect(
    group.locator("code").filter({ hasText: "models/My-Exact-Image" }),
  ).toBeVisible();
  expect(api.writes.at(-1)?.config.manualModels).toEqual([
    {
      id: "models/My-Exact-Image",
      name: "models/My-Exact-Image",
      capability: "image",
      protocol: "openai-images",
    },
  ]);
  expect(api.writes.at(-1)?.apiKey).toBeUndefined();
  await group
    .getByLabel("private-vip 的用途", { exact: true })
    .selectOption("agent");
  await expect(
    group.getByText("○ 尚未配置 Key", { exact: true }),
  ).toBeVisible();
  await expect(
    group.getByRole("button", { name: "测试并读取", exact: true }),
  ).toBeDisabled();
  await group
    .getByLabel("private-vip 智能体 API Key", { exact: true })
    .fill("fixture-agent-key");
  await group.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => api.connections().length).toBe(2);
  expect(
    api
      .connections()
      .map((connection) => connection.config.usage)
      .sort(),
  ).toEqual(["agent", "canvas"]);
  expect(api.writes.at(-1)?.id).toBeUndefined();
  expect(api.writes.at(-1)?.apiKey).toBe("fixture-agent-key");
  await page.screenshot({
    path: "test-results-suppliers/suppliers-manual-flow.png",
    fullPage: true,
  });
});

test("公开目录与实际 Key 结果分别呈现，陈旧缓存不冒充刷新成功", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await mockSuppliers(page, { existing: true, stale: true });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const group = dialog
    .locator(".sm-group-card")
    .filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await group.getByRole("button", { name: /模型清单/ }).click();
  await expect(
    group.locator("strong").filter({ hasText: "站点目录" }),
  ).toBeVisible();
  await expect(group.getByText("Key 实际读取", { exact: true })).toBeVisible();
  await expect(
    group.locator("code").filter({ hasText: "scanned-image" }),
  ).toBeVisible();
  await group.getByRole("button", { name: "刷新模型", exact: true }).click();
  await expect(
    group.getByText("本次扫描未完成，已有模型与配置已保留，请稍后重试。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    group.locator("code").filter({ hasText: "scanned-image" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results-suppliers/suppliers-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results-suppliers/suppliers-mobile.png",
    fullPage: true,
  });
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("已有 REST 视频连接可手动添加准确模型并保留原 Key 和协议", async ({
  page,
}) => {
  const api = await mockSuppliers(page, { existing: true, restVideo: true });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const group = dialog
    .locator(".sm-group-card")
    .filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await group
    .getByRole("button", { name: "手动添加模型", exact: true })
    .click();
  await expect(
    group.getByRole("combobox", { name: "能力类型", exact: true }),
  ).toHaveValue("video");
  await expect(
    group.getByRole("combobox", { name: "调用协议", exact: true }),
  ).toHaveValue("rest");
  await group
    .getByRole("textbox", { name: "准确模型 ID", exact: true })
    .fill("configured-video");
  await group
    .getByRole("button", { name: "保存为未验证模型", exact: true })
    .click();
  await expect(
    group.locator("code").filter({ hasText: "configured-video" }),
  ).toBeVisible();
  expect(api.writes.at(-1)?.config.manualModels).toEqual([
    {
      id: "configured-video",
      name: "configured-video",
      capability: "video",
      protocol: "rest",
    },
  ]);
  expect(api.writes.at(-1)?.id).toBe("connection-fixture");
  expect(api.writes.at(-1)?.apiKey).toBeUndefined();
  expect(api.writes.at(-1)?.config.connector).toEqual({
    models: [
      {
        id: "configured-video",
        name: "Configured Video",
        operations: ["video.generate"],
      },
    ],
  });
});
