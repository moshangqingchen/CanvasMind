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
    accountKeySync?: boolean;
    groupDetails?: boolean;
  } = {},
) {
  let suppliers = options.existing ? [fixtureSupplier()] : [];
  if (options.groupDetails && suppliers[0]) suppliers[0].catalog.groups[0]!.details = {
    source:"key-groups", description:"1张0.015，量大1分，仅支持1K2K，不支持4K。充值1刀1毛",
    referencePrice:"1张0.015；量大1分", supportedResolutions:["1K","2K"], unsupportedResolutions:["4K"], exclusiveResolutions:true,
    imagePrices:[{resolution:"1K",amount:0.15},{resolution:"2K",amount:0.15},{resolution:"4K",amount:0.15}], rateMultiplier:1,
  };
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
  if (options.accountKeySync && connections[0]) connections[0].apiKeySet = false;
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
      if (options.accountKeySync) {
        const checkedAt = new Date().toISOString();
        connections = connections.map(connection => ({ ...connection, apiKeySet: true, apiKeyUsable: true,
          config: { ...connection.config, accountKeyImportedAt: checkedAt, modelScanStatus: "live" } }));
        suppliers = [{ ...current, scanStatus: "live", scannedAt: checkedAt,
          state: { version: 1, revision: 2, visibility: "visible", sourceId: "fixture-source", fingerprint: "fixture", history: [],
            keySync: { status: "live", imported: 1, preserved: 0, skipped: 0, multipleGroups: 0, checkedAt } } }];
        await route.fulfill({ json: suppliers[0] });
        return;
      }
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
      if (options.stale) {
        await route.fulfill({ status: 502, json: { error: "本次扫描未完成，已有模型与配置已保留，请稍后重试。" } });
      } else {
        await route.fulfill({ json: { message: "连接测试成功", status: options.existing ? "live" : "empty", models: options.existing ? [{ id: "scanned-image", name: "Scanned Image", operations: ["image.generate"] }] : [] } });
      }
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

test("保存 Key 后自动读取模型，读取失败保留新 Key 并显示可重试结果", async ({ page }) => {
  const api = await mockSuppliers(page, { existing: true });
  let reads = 0;
  await page.route("**/api/providers/connection-fixture/test", async route => {
    reads += 1;
    await route.fulfill(reads === 1
      ? { status: 502, json: { error: "模型目录暂时无法读取，请重试。" } }
      : { json: { message: "连接测试成功", status: "live", models: [{ id: "discovered-chat", name: "Discovered Chat", operations: [], outputKinds: ["text"] }] } });
  });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  const group = dialog.locator(".sm-group-card").filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await group.getByLabel("vip API Key", { exact: true }).fill("replacement-test-key");
  await group.getByRole("button", { name: "保存", exact: true }).click();
  await expect(group.getByText("模型目录暂时无法读取，请重试。", { exact: true })).toBeVisible();
  expect(reads).toBe(1);
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]).toMatchObject({ id: "connection-fixture", apiKey: "replacement-test-key" });
  await expect(group.getByLabel("vip API Key", { exact: true })).toHaveValue("");
  await group.getByRole("button", { name: "测试并读取", exact: true }).click();
  await expect(group.getByRole("status")).toContainText("已读取 1 个模型。");
  expect(reads).toBe(2);
  expect(api.writes).toHaveLength(1);
});

test("同组旧画布与智能体连接都保留，切换连接不复制 Key 或修改专用协议", async ({ page }) => {
  const api = await mockSuppliers(page, { existing: true, restVideo: true });
  const original = structuredClone(api.connections()[0]!);
  api.connections().push({
    ...original,
    id: "connection-chat",
    name: "同组另一把 Key",
    provider: "rest",
    config: { ...original.config, usage: "agent", protocol: "anthropic-messages", defaultModel: "chat-model" },
  }, {
    ...original,
    id: "connection-disabled",
    name: "停用连接",
    config: { ...original.config, usage: "disabled" },
  });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const group = dialog.locator(".sm-group-card").filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(group.getByLabel("vip 的用途", { exact: true })).toHaveCount(0);
  const selected = group.getByLabel("vip 已保存的连接", { exact: true });
  await expect(selected.locator("option")).toHaveCount(2);
  await selected.selectOption("connection-chat");
  await expect(group.getByLabel("vip API Key", { exact: true })).toHaveValue("");
  await expect(group.getByRole("button", { name: "测试并读取", exact: true })).toBeEnabled();
  expect(api.writes).toEqual([]);
  await selected.selectOption(original.id);
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
  await group.getByPlaceholder("选择或填写准确模型 ID").fill("rest-video-model");
  await group.getByRole("button", { name: "保存默认", exact: true }).click();
  await expect.poll(() => api.writes.length).toBe(1);
  expect(api.writes[0]).toMatchObject({ id: original.id, provider: original.provider, config: { connector: original.config.connector } });
  expect(api.writes[0]).not.toHaveProperty("apiKey");
  expect(api.connections()).toHaveLength(3);
  expect(api.connections().find(connection => connection.id === "connection-chat")?.config.protocol).toBe("anthropic-messages");
});

test("已有 REST 视频 Key 可添加独立对话模型协议，并保留原视频连接器", async ({ page }) => {
  const api = await mockSuppliers(page, { existing: true, restVideo: true });
  const connector = structuredClone(api.connections()[0]!.config.connector);
  await openSettings(page);
  const group = page.locator(".sm-group-card").filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await group.getByRole("button", { name: "手动添加模型", exact: true }).click();
  await group.getByLabel("准确模型 ID", { exact: true }).fill("gateway-chat");
  await group.getByRole("combobox", { name: "能力类型", exact: true }).selectOption("chat");
  await group.getByRole("combobox", { name: "调用协议", exact: true }).selectOption("responses");
  await group.getByRole("button", { name: "保存为未验证模型", exact: true }).click();
  await expect.poll(() => api.writes.length).toBe(1);
  expect(api.writes[0]).toMatchObject({ id: "connection-fixture", provider: "rest", config: {
    connector, manualModels: [{ id: "gateway-chat", name: "gateway-chat", capability: "chat", protocol: "responses" }],
  } });
  expect(api.writes[0]).not.toHaveProperty("apiKey");
});

test("参考图临时链接默认关闭，独立保存与关闭不触发生图核验", async ({ page }, testInfo) => {
  const api = await mockSuppliers(page, { existing: true, restVideo: true });
  let tests = 0;
  const settingWrites: unknown[] = [];
  await page.route("**/api/providers/connection-fixture", async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    settingWrites.push(body);
    const connection = api.connections()[0]!;
    connection.config = { ...connection.config, ...body };
    await route.fulfill({ json: connection });
  });
  await page.route("**/api/providers/*/test", route => { tests++; return route.fulfill({ json: { message: "test" } }); });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
  const hosting = dialog.getByRole("checkbox", { name: "参考图临时链接" });
  await expect(hosting).not.toBeChecked();
  await hosting.check();
  await dialog.getByRole("button", { name: "保存链接设置" }).click();
  await expect.poll(() => settingWrites.at(-1)).toEqual({ referenceImageHosting: "litterbox-24h" });
  await expect(dialog.getByRole("status")).toContainText("参考图临时链接已启用");
  expect(api.writes).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("reference-hosting-setting.png") });
  await page.reload();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
  await expect(hosting).toBeChecked();
  await hosting.uncheck();
  await dialog.getByRole("button", { name: "保存链接设置" }).click();
  await expect.poll(() => settingWrites.at(-1)).toEqual({ referenceImageHosting: "disabled" });
  await expect(dialog.getByRole("status")).toContainText("参考图临时链接已关闭");
  expect(api.writes).toEqual([]);
  expect(tests).toBe(0);
});

test("刷新全部供应商同步分组和模型，显示新增与未再返回并保留原 Key", async ({ page }) => {
  const api = await mockSuppliers(page, { existing: true });
  let scans = 0;
  await page.route("**/api/suppliers/supplier-fixture/scan", async route => {
    scans++;
    const record = api.suppliers()[0]!;
    record.scannedAt = "2026-09-17T09:00:00.000Z";
    record.catalog.groups[0]!.label = "VIP 新名称";
    record.catalog.groups.push({ id: "new-group", label: "新增组", source: "catalog", status: "available", models: [] });
    const connection = api.connections()[0]!;
    connection.config = { ...connection.config, modelScanCheckedAt: record.scannedAt,
      modelCatalogModels: [{ id: "new-image", name: "New Image", operations: ["image.generate"] }],
      scannedModelIds: ["new-image"], modelAddedIds: ["new-image"], modelRemovedModels: [{ id: "old-image", name: "Old Image" }] };
    await route.fulfill({ json: record });
  });
  await page.route("**/api/providers/connection-fixture/models?**", route => route.fulfill({
    json: api.connections()[0]!.config.modelCatalogModels || [], headers: { "X-Model-Scan-Status": "live" },
  }));
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("button", { name: "刷新全部供应商", exact: true }).click();
  await expect(dialog.getByText("刷新完成：1 家供应商", { exact: true })).toBeVisible();
  await expect(dialog.getByText("VIP 新名称", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "new-group", exact: true })).toBeVisible();
  const group = dialog.locator(".sm-group-card").filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await expect(group.getByRole("button", { name: /模型清单/u })).toHaveAttribute("aria-expanded", "true");
  const added = group.locator(".sm-model-item").filter({ hasText: "new-image" });
  await expect(added.getByText("目录已确认", { exact: true })).toBeVisible();
  await expect(added.getByText("新增", { exact: true })).toBeVisible();
  await group.getByLabel("vip 模型来源", { exact: true }).selectOption("missing");
  await expect(group.locator(".sm-model-item").filter({ hasText: "old-image" }).getByText("未再返回", { exact: true })).toBeVisible();
  expect(scans).toBe(1);
  expect(api.writes).toEqual([]);
  expect(api.connections()[0]!.apiKeySet).toBe(true);
});

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
    dialog.getByRole("region", { name: "未再返回的分组", exact: true }).getByRole("heading", { name: "absent", exact: true }),
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

test("读取密钥分组说明，区分分辨率限制和后台标价，并保留完整原文", async ({ page }) => {
  await mockSuppliers(page, { existing:true, groupDetails:true });
  await openSettings(page);
  const details = page.getByRole("region", { name:"vip 分组说明" });
  await expect(details).toContainText("来源：密钥分组页");
  await expect(details).toContainText("1张0.015，量大1分，仅支持1K2K，不支持4K。充值1刀1毛");
  await expect(details).toContainText("仅支持 1K / 2K；不支持 4K");
  await details.getByText("后台分辨率标价（额度/张）", {exact:true}).click();
  await expect(details.getByText("说明不支持，标价不代表可用", {exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole("button", {name:"供应商与模型",exact:true}).click();
  await expect(details).toContainText("仅支持 1K / 2K；不支持 4K");
});

test("登录扫描后自动填入已有分组 Key，并展示同步结果与模型", async ({ page }) => {
  await mockSuppliers(page, { existing: true, accountKeySync: true });
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await dialog.getByLabel("站点账号", { exact: true }).fill("user@example.com");
  await dialog.getByLabel("站点密码", { exact: true }).fill("login-password");
  await dialog.getByRole("button", { name: "保存并扫描", exact: true }).click();
  await expect(dialog.getByLabel("账号密钥同步结果")).toContainText("已自动填入 1 个分组 Key");
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(dialog.getByText("● 已从站点同步 Key", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("vip API Key", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("vip API Key", { exact: true })).toHaveAttribute("placeholder", "已从站点自动填入 · 留空保留原 Key");
  await expect(dialog.getByRole("button", { name: "测试并读取", exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(dialog.getByText("● 已从站点同步 Key", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("账号密钥同步结果")).toContainText("已自动填入 1 个分组 Key");
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
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
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
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
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
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(
    group.getByLabel("vip API Key", { exact: true }),
  ).toHaveAttribute("autocomplete", "new-password");
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
  await group.getByRole("button", { name: "刷新模型", exact: true }).click();
  await expect(
    group.getByText(/已读取 1 个模型。/u),
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

test("供应商可从地址扫描失败转手动分组，画布和智能体共用已有 Key", async ({
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
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
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
    .getByLabel("private-vip API Key", { exact: true })
    .fill("fixture-canvas-key");
  await group.getByRole("button", { name: "测试并读取", exact: true }).click();
  await expect(
    group.getByText("Key 模型列表读取成功，返回 0 个模型。", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
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
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(group.getByLabel("private-vip 的用途", { exact: true })).toHaveCount(0);
  await expect(group.getByLabel("private-vip API Key", { exact: true })).toHaveValue("");
  await expect(group.getByText("画布与智能体按模型能力共用", { exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "测试并读取", exact: true })).toBeEnabled();
  expect(api.connections()).toHaveLength(1);
  expect(api.writes.filter(write => write.apiKey)).toHaveLength(1);
  expect(api.writes.find(write => write.apiKey)?.apiKey).toBe("fixture-canvas-key");
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
  await group.getByLabel("vip 模型来源", { exact: true }).selectOption("catalog");
  await expect(
    group.locator("strong").filter({ hasText: "站点目录" }),
  ).toBeVisible();
  await group.getByLabel("vip 模型来源", { exact: true }).selectOption("actual");
  await expect(group.getByText("Key 实际读取", { exact: true })).toBeVisible();
  await expect(
    group.locator("code").filter({ hasText: "scanned-image" }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
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
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
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
