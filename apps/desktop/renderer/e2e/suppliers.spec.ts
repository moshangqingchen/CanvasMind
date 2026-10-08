import { expect, test, type Page } from "@playwright/test";
import type { ProviderConnectionView } from "../lib/client-api";
import type { SupplierRecord, SupplierSiteLoginSummary } from "../lib/client-suppliers";

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
    siteLogin?: SupplierSiteLoginSummary;
  } = {},
) {
  let suppliers = options.existing ? [fixtureSupplier()] : [];
  if (suppliers[0] && options.siteLogin) suppliers[0].siteLogin = options.siteLogin;
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
      const sourceChanged = (patch.siteUrl !== undefined && patch.siteUrl !== current.siteUrl) ||
        (patch.apiUrl !== undefined && patch.apiUrl !== current.apiUrl);
      const savedLogin = sourceChanged ? undefined : current.siteLogin;
      const loginSummary: SupplierSiteLoginSummary | undefined = siteLogin === null
        ? undefined
        : siteLogin?.authMode === "access-token"
          ? {
              authMode: "access-token", configured: true,
              ...(siteLogin.userId === null ? {} : siteLogin.userId !== undefined
                ? { userId: siteLogin.userId }
                : savedLogin?.authMode === "access-token" && savedLogin.userId ? { userId: savedLogin.userId } : {}),
            }
          : siteLogin
            ? { username: siteLogin.username, configured: true }
            : savedLogin;
      suppliers = [
        {
          ...current,
          ...patch,
          catalog,
          siteLogin: loginSummary,
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

function supplierMutations(page: Page) {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/suppliers") && request.method() !== "GET")
      requests.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  return requests;
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

test("后台目录升级同步已打开的官网与 Key 清单，并保留未保存的 Key 草稿", async ({ page }, testInfo) => {
  const api = await mockSuppliers(page, { existing: true, restVideo: true });
  const supplier = api.suppliers()[0]!;
  const connection = api.connections()[0]!;
  supplier.catalog.groups[0]!.models = [{ id: "seedance-2.0-fast", capability: "video", outputKinds: ["video"] }];
  connection.config = { ...connection.config, modelScanCheckedAt: supplier.scannedAt, scannedModelIds: ["seedance-2.0-fast"],
    modelCatalogModels: [{ id: "seedance-2.0-fast", name: "Seedance Fast", operations: ["video.generate"], outputKinds: ["video"] }] };
  let cachedReads = 0;
  await page.route("**/api/providers/connection-fixture/models?**", async route => {
    expect(new URL(route.request().url()).searchParams.get("cached")).toBe("1");
    cachedReads++;
    await route.fulfill({ json: connection.config.modelCatalogModels, headers: { "X-Model-Scan-Status": "live" } });
  });
  const mutations = supplierMutations(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const group = dialog.locator(".sm-group-card").filter({ has: page.getByRole("heading", { name: "vip", exact: true }) });
  await expect(group.getByLabel("官网与 Key 目录对照")).toContainText("官网目录 1 · Key 1");
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await group.getByLabel("vip API Key", { exact: true }).fill("unsaved-fixture-key");

  const checkedAt = "2026-10-08T23:00:00.000Z";
  supplier.scannedAt = checkedAt;
  supplier.catalog.groups[0]!.models.push({ id: "dola-seedance-2.5", capability: "video", outputKinds: ["video"], priceLabel: "720p ¥0.875/次" });
  supplier.catalog.groups.push({ id: "video-new", label: "新视频组", source: "catalog", models: [] });
  connection.config = { ...connection.config, modelScanCheckedAt: checkedAt, scannedModelIds: ["seedance-2.0-fast", "dola-seedance-2.5"],
    modelCatalogModels: [...connection.config.modelCatalogModels as object[], { id: "dola-seedance-2.5", name: "Dola Seedance 2.5",
      operations: ["video.generate"], outputKinds: ["video"], metadata: { priceLabel: "720p ¥0.875/次" } }] };
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("supplier-catalog-upgraded")));
  await expect(dialog.getByRole("heading", { name: "video-new", exact: true })).toBeVisible();
  await expect(group.getByLabel("vip API Key", { exact: true })).toHaveValue("unsaved-fixture-key");
  await expect(group.getByLabel("官网与 Key 目录对照")).toContainText("官网目录 2 · Key 2");
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
  await group.getByLabel("vip 模型类型", { exact: true }).selectOption("video");
  await expect(group.locator(".sm-model-item").filter({ hasText: "dola-seedance-2.5" })).toContainText("720p ¥0.875/次");
  await group.getByLabel("vip 模型来源", { exact: true }).selectOption("catalog");
  const publicDola = group.locator(".sm-model-item").filter({ hasText: "dola-seedance-2.5" });
  await expect(publicDola).toBeVisible();
  await expect(publicDola).toContainText("720p ¥0.875/次");
  await page.screenshot({ path: testInfo.outputPath("catalog-upgraded-open-settings.png"), fullPage: true });
  expect(cachedReads).toBeGreaterThanOrEqual(2);
  expect(api.writes).toEqual([]);
  expect(mutations).toEqual([]);
  expect(connection.apiKeySet).toBe(true);
});

test("单家刷新独立于其他供应商，详情列出分组模型接口价格变化并支持键盘与窄窗口", async ({ page }, testInfo) => {
  const api = await mockSuppliers(page, { existing: true });
  const record = api.suppliers()[0]!;
  record.catalog.groups.push({ id: "retired", label: "旧公开组", source: "catalog", models: [] },
    { id: "personal", label: "我的自定义组", source: "manual", models: [{ id: "personal-model", capability: "image" }] });
  api.suppliers().push({ ...fixtureSupplier(), id: "supplier-other", name: "另一家供应商", supplierKey: "other", siteUrl: "https://other.example.com", apiUrl: "https://other.example.com/v1" });
  const connection = api.connections()[0]!;
  connection.config.modelScanCheckedAt = record.scannedAt;
  connection.config.scannedModelIds = ["stable-image", "old-image"];
  connection.config.modelCatalogModels = [
    { id: "stable-image", name: "持续保留模型", operations: ["image.generate"], metadata: { protocol: "openai-images", autoInterfacePath: "/v1/images/generations", priceLabel: "0.10 USD" } },
    { id: "old-image", name: "旧模型", operations: ["image.generate"] },
  ];
  const scans: string[] = [];
  await page.route(/\/api\/suppliers\/[^/]+\/scan$/u, async route => {
    const id = new URL(route.request().url()).pathname.split("/")[3]!;
    scans.push(id);
    const checkedAt = new Date().toISOString();
    record.scannedAt = checkedAt;
    record.scanComplete = true;
    record.catalog.groups[0]!.label = "VIP 新名称";
    record.catalog.groups.find(group => group.id === "retired")!.status = "missing";
    record.catalog.groups.push({ id: "new-group", label: "新公开组", source: "catalog", models: [] });
    connection.config = { ...connection.config, modelScanCheckedAt: checkedAt, scannedModelIds: ["stable-image", "new-image"],
      modelCatalogModels: [
        { id: "stable-image", name: "持续保留模型", operations: ["image.edit"], metadata: { protocol: "rest", autoInterfacePath: "/v2/images/edit", priceLabel: "0.20 USD" } },
        { id: "new-image", name: "新模型", operations: ["image.generate"], metadata: { canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "站点尚未提供完整的图片接口资料。", priceStatus: "unpublished" } },
      ] };
    await route.fulfill({ json: record });
  });
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  const row = settings.locator(".sm-supplier-row").filter({ has: page.locator(".sm-supplier-label strong").filter({ hasText: /^测试供应商$/u }) });
  await row.getByRole("button", { name: "刷新 测试供应商", exact: true }).click();
  await expect(settings.getByText("刷新完成：1 家供应商", { exact: true })).toBeVisible();
  const opener = row.getByRole("button", { name: "查看 测试供应商 刷新状态", exact: true });
  await opener.click();
  const details = page.getByRole("dialog", { name: "供应商刷新详情" });
  await expect(details.getByRole("heading", { name: "测试供应商", exact: true })).toBeVisible();
  await expect(details.getByRole("region", { name: "刷新概况" })).toContainText("部分待确认");
  await expect(details.getByRole("region", { name: "待处理事项" })).toContainText("1 个模型接口待确认");
  await expect(details.getByRole("region", { name: "待处理事项" })).toContainText("站点尚未提供完整的图片接口资料。");
  const groupChanges = details.getByRole("region", { name: "分组变化详情" });
  await expect(groupChanges.getByText("新公开组", { exact: true })).toBeVisible();
  await expect(groupChanges.getByText("旧公开组", { exact: true })).toBeVisible();
  await expect(groupChanges.getByText("VIP 创作组 → VIP 新名称", { exact: true })).toBeVisible();
  const connectionDetails = details.getByRole("region", { name: "连接与模型详情" });
  await expect(connectionDetails.getByText("新增模型（1）", { exact: true })).toBeVisible();
  await expect(connectionDetails.getByText("未再返回的模型（1）", { exact: true })).toBeVisible();
  await expect(connectionDetails.getByText("价格变化（1）", { exact: true })).toBeVisible();
  await expect(connectionDetails.getByText(/0\.10 USD → 0\.20 USD/u)).toBeVisible();
  await connectionDetails.locator("summary").filter({ hasText: "接口待确认的模型" }).click();
  await expect(connectionDetails.getByText(/尚未提供完整/u)).toBeVisible();
  await connectionDetails.locator("summary").filter({ hasText: "价格待确认的模型" }).click();
  await expect(connectionDetails.getByText(/供应商未公布价格/u)).toBeVisible();
  await expect(details.getByRole("region", { name: "待处理事项" })).not.toContainText("供应商未公布价格");
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(settings).toBeVisible();
  await opener.click();
  await expect(details.getByRole("button", { name: "关闭刷新详情" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(details.getByRole("button", { name: "完成", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(details.getByRole("button", { name: "关闭刷新详情" })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const bounds = await details.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath("supplier-refresh-details-mobile.png") });
  await page.keyboard.press("Escape");
  expect(scans).toEqual(["supplier-fixture"]);
  expect(api.writes).toEqual([]);
  expect(connection.apiKeySet).toBe(true);
  expect(record.catalog.groups.find(group => group.id === "personal")?.models[0]?.id).toBe("personal-model");
});

test("全部刷新每家可查看独立失败项目，保留旧模型与已保存 Key", async ({ page }) => {
  const api = await mockSuppliers(page, { existing: true });
  const other = { ...fixtureSupplier(), id: "supplier-other", name: "网络异常供应商", supplierKey: "other", siteUrl: "https://other.example.com", apiUrl: "https://other.example.com/v1" };
  api.suppliers().push(other);
  const connection = api.connections()[0]!;
  connection.config.modelCatalogModels = [{ id: "saved-model", name: "已有模型", operations: ["image.generate"] }];
  await page.route(/\/api\/suppliers\/[^/]+\/scan$/u, async route => {
    if (route.request().url().includes("supplier-other")) {
      await route.fulfill({ status: 502, json: { error: "网关未返回完整响应。Bearer sk-mock-diagnostic-secret" } });
      return;
    }
    const record = api.suppliers()[0]!;
    record.scannedAt = new Date().toISOString();
    record.scanComplete = true;
    connection.config = { ...connection.config, modelScanStatus: "stale", modelScanCheckedAt: record.scannedAt,
      modelScanHttpStatus: 502, modelScanError: "模型接口暂不可用，请稍后重试。",
      modelCatalogModels: [{ id: "saved-model", name: "已有模型", operations: ["image.generate"], metadata: { priceStatus: "failed", priceLabel: "上次标价已保留" } }] };
    await route.fulfill({ json: record });
  });
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  await settings.getByRole("button", { name: "刷新全部供应商", exact: true }).click();
  await expect(settings.getByText("刷新完成：2 家供应商", { exact: true })).toBeVisible();
  const report = settings.getByRole("region", { name: "供应商刷新结果" });
  const firstOpener = report.getByRole("button", { name: "查看 测试供应商 刷新详情", exact: true });
  await firstOpener.click();
  const details = page.getByRole("dialog", { name: "供应商刷新详情" });
  await expect(details.getByRole("region", { name: "待处理事项" })).toContainText("模型接口暂不可用，请稍后重试。");
  await expect(details.getByRole("region", { name: "连接与模型详情" })).toContainText("HTTP 502");
  await expect(details.getByRole("region", { name: "待处理事项" })).toContainText("1 个模型价格读取未完成");
  await details.getByRole("region", { name: "连接与模型详情" }).locator("summary").filter({ hasText: "价格待确认的模型" }).click();
  await expect(details.getByRole("region", { name: "连接与模型详情" }).getByText(/本次价格读取失败/u)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(firstOpener).toBeFocused();
  await report.getByRole("button", { name: "查看 网络异常供应商 刷新详情", exact: true }).click();
  await expect(details.getByRole("region", { name: "待处理事项" })).toContainText("本次请求未完成");
  await expect(details).not.toContainText("sk-mock-diagnostic-secret");
  await page.keyboard.press("Escape");
  expect(api.writes).toEqual([]);
  expect(connection.apiKeySet).toBe(true);
  expect((connection.config.modelCatalogModels as Array<{ id: string }>)[0]!.id).toBe("saved-model");
});

test("连接配置可查看已保存状态而不丢草稿，保存并扫描后显示本次变化", async ({ page }) => {
  const api = await mockSuppliers(page, { existing: true });
  await page.route("**/api/suppliers/supplier-fixture/scan", async route => {
    const record = api.suppliers()[0]!;
    record.scannedAt = new Date().toISOString();
    record.scanComplete = true;
    record.catalog.groups.push({ id: "scan-added", label: "扫描新增组", source: "catalog", models: [] });
    const connection = api.connections()[0]!;
    connection.config = { ...connection.config, modelScanCheckedAt: record.scannedAt, scannedModelIds: ["scan-added-model"],
      modelCatalogModels: [{ id: "scan-added-model", name: "本次新增模型", operations: ["image.generate"] }] };
    await route.fulfill({ json: record });
  });
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  await settings.getByRole("tab", { name: "连接配置", exact: true }).click();
  const name = settings.getByLabel("供应商名称", { exact: true });
  await name.fill("未保存的名称草稿");
  await settings.locator(".sm-detail-heading").getByRole("button", { name: "查看 测试供应商 刷新状态", exact: true }).click();
  const details = page.getByRole("dialog", { name: "供应商刷新详情" });
  await expect(details.getByText("仅展示已保存状态；刷新后可查看本次变化。", { exact: true })).toBeVisible();
  await expect(details.getByRole("region", { name: "分组变化详情" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(name).toHaveValue("未保存的名称草稿");
  await settings.getByRole("button", { name: "保存并扫描", exact: true }).click();
  const notice = settings.getByRole("button", { name: "查看配置刷新状态", exact: true });
  await expect(notice).toBeVisible();
  await notice.click();
  await expect(details.getByRole("region", { name: "分组变化详情" }).getByText("扫描新增组", { exact: true })).toBeVisible();
  await expect(details.getByRole("region", { name: "连接与模型详情" }).locator("details")
    .filter({ has: page.getByText("新增模型（1）", { exact: true }) }).getByText("scan-added-model", { exact: true })).toBeVisible();
  await expect(details.getByText("仅展示已保存状态；刷新后可查看本次变化。", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(notice).toBeFocused();
  expect(api.writes).toEqual([]);
});

test("十三家刷新结果用状态统计和收起列表呈现，展开后内部滚动且各家可查看详情", async ({ page }, testInfo) => {
  const api = await mockSuppliers(page, { existing: true });
  for (let index = 2; index <= 13; index++) api.suppliers().push({ ...fixtureSupplier(), id: `supplier-${index}`, name: `创作供应商 ${index}`, supplierKey: `supplier-${index}` });
  await page.route(/\/api\/suppliers\/[^/]+\/scan$/u, async route => {
    const id = new URL(route.request().url()).pathname.split("/")[3]!;
    const record = api.suppliers().find(item => item.id === id)!;
    record.scannedAt = new Date().toISOString();
    record.scanComplete = true;
    if (id === "supplier-fixture") api.connections()[0]!.config.modelScanCheckedAt = record.scannedAt;
    await route.fulfill({ json: record });
  });
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  await settings.getByRole("button", { name: "刷新全部供应商", exact: true }).click();
  await expect(settings.getByText("刷新完成：13 家供应商", { exact: true })).toBeVisible();
  const report = settings.getByRole("region", { name: "供应商刷新结果" });
  await expect(report.locator(".sm-refresh-overview")).toBeVisible();
  await expect(report.locator('.sm-refresh-overview > [data-status="updated"] strong')).toHaveText("1");
  await expect(report.locator('.sm-refresh-overview > [data-status="partial"] strong')).toHaveText("12");
  await expect(report.locator(".sm-refresh-disclosure")).not.toHaveAttribute("open");
  await report.locator("summary").click();
  await expect(report.getByRole("button", { name: /刷新详情$/u })).toHaveCount(13);
  const layout = await report.locator(".sm-refresh-results").evaluate(element => ({
    height: element.clientHeight, scrollable: element.scrollHeight > element.clientHeight, overflow: getComputedStyle(element).overflowY,
  }));
  expect(layout.height).toBeLessThanOrEqual(280);
  expect(layout.scrollable).toBe(true);
  expect(layout.overflow).toBe("auto");
  await page.screenshot({ path: testInfo.outputPath("suppliers-refresh-overview-desktop.png") });
  const opener = report.getByRole("button", { name: "查看 创作供应商 13 刷新详情", exact: true });
  await opener.click();
  const details = page.getByRole("dialog", { name: "供应商刷新详情" });
  await expect(details.getByRole("heading", { name: "创作供应商 13", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("supplier-refresh-details-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
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

test("访问令牌保存扫描、留空保留、更新和清除，响应与输入不回填秘密", async ({ page }, testInfo) => {
  const mock = await mockSuppliers(page, { existing: true, groupCount: 2 });
  const requests = supplierMutations(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await dialog.getByLabel("登录方式", { exact: true }).selectOption("access-token");
  const token = dialog.getByLabel("站点访问令牌", { exact: true });
  const id = dialog.getByLabel("站点用户 ID（选填）", { exact: true });
  await expect(token).toHaveAttribute("type", "password");
  await expect(token).toHaveAttribute("maxlength", "8192");
  await token.fill(" Bearer dummy-site-access-token ");
  await id.fill("123");
  await dialog.getByRole("button", { name: "保存并扫描", exact: true }).click();
  await expect(token).toHaveValue("");
  await expect(token).toHaveAttribute("placeholder", "已保存，留空保持原令牌");
  await expect(dialog.getByText("已识别 2 个分组。", { exact: false })).toBeVisible();
  expect(requests.find((request) => request.method === "PATCH")?.body.siteLogin).toEqual({
    authMode: "access-token", accessToken: "dummy-site-access-token", userId: "123",
  });
  expect(requests.find((request) => request.path.endsWith("/scan"))?.body).not.toHaveProperty("siteLogin");
  expect(mock.suppliers()[0]?.siteLogin).toEqual({ authMode: "access-token", configured: true, userId: "123" });
  await page.reload();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(dialog.getByLabel("登录方式", { exact: true })).toHaveValue("access-token");
  await expect(token).toHaveValue("");
  await expect(id).toHaveValue("123");
  await expect(dialog).not.toContainText("dummy-site-access-token");
  await token.scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: testInfo.outputPath("supplier-access-token-saved.png") });
  requests.length = 0;
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByText("供应商信息已保存。", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.body).not.toHaveProperty("siteLogin");
  requests.length = 0;
  await token.fill("dummy-updated-access-token");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(token).toHaveValue("");
  expect(requests.at(-1)?.body.siteLogin).toEqual({
    authMode: "access-token", accessToken: "dummy-updated-access-token", userId: "123",
  });
  expect(JSON.stringify(mock.suppliers())).not.toContain("dummy-updated-access-token");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("dummy-updated-access-token");
  await dialog.getByRole("button", { name: "清除已保存登录", exact: true }).click();
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByLabel("站点密码", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("站点账号", { exact: true })).toHaveValue("");
  expect(requests.at(-1)?.body.siteLogin).toBeNull();
  expect(mock.suppliers()[0]?.siteLogin).toBeUndefined();
});

test("访问令牌只修改或清空用户 ID 无需重输令牌，格式错误不提交", async ({ page }) => {
  const mock = await mockSuppliers(page, { existing: true, siteLogin: { authMode: "access-token", configured: true, userId: "123" } });
  const requests = supplierMutations(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  const token = dialog.getByLabel("站点访问令牌", { exact: true });
  const id = dialog.getByLabel("站点用户 ID（选填）", { exact: true });
  for (const invalidToken of ["Bearer", "dummy token", "dummy\ttoken"]) {
    await token.fill(invalidToken);
    await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
    await expect(dialog.getByText("请填写有效的站点访问令牌，不含内部空白或控制字符。", { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText(invalidToken);
  }
  await token.fill("");
  for (const invalidId of ["0", "-1", "1.5", "abc", "01", "9223372036854775808"]) {
    await id.fill(invalidId);
    await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
    await expect(dialog.getByText("站点用户 ID 必须是 1 至 9223372036854775807 的整数，或留空。", { exact: true })).toBeVisible();
  }
  expect(requests).toHaveLength(0);
  await id.fill("9223372036854775807");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByText("供应商信息已保存。", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.body.siteLogin).toEqual({ authMode: "access-token", userId: "9223372036854775807" });
  await expect(token).toHaveValue("");
  expect(mock.suppliers()[0]?.siteLogin?.userId).toBe("9223372036854775807");
  await id.fill("");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "仅保存", exact: true })).toBeEnabled();
  expect(requests.at(-1)?.body.siteLogin).toEqual({ authMode: "access-token", userId: null });
  expect(mock.suppliers()[0]?.siteLogin).toEqual({ authMode: "access-token", configured: true });
  requests.length = 0;
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "仅保存", exact: true })).toBeEnabled();
  expect(requests.at(-1)?.body).not.toHaveProperty("siteLogin");
  await dialog.getByRole("combobox", { name: "平台类型", exact: true }).selectOption("sub2api");
  await expect(id).toHaveCount(0);
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "仅保存", exact: true })).toBeEnabled();
  expect(requests.at(-1)?.body).not.toHaveProperty("siteLogin");
});

test("访问令牌切换方式清空待输入秘密，空令牌拒绝保存，取消和放弃完整处理草稿", async ({ page }) => {
  await mockSuppliers(page, { existing: true, siteLogin: { configured: true, username: "saved@example.com" } });
  const requests = supplierMutations(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  const mode = dialog.getByLabel("登录方式", { exact: true });
  await dialog.getByLabel("站点密码", { exact: true }).fill("dummy-draft-password");
  await mode.selectOption("access-token");
  const token = dialog.getByLabel("站点访问令牌", { exact: true });
  await expect(token).toHaveValue("");
  await expect(token).toHaveAttribute("placeholder", "请输入站点访问令牌");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByText("首次保存或更换登录方式、连接地址时，请填写站点访问令牌。", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await token.fill("dummy-draft-token");
  await mode.selectOption("password");
  await expect(dialog.getByLabel("站点密码", { exact: true })).toHaveValue("");
  await mode.selectOption("access-token");
  await expect(token).toHaveValue("");
  await token.fill("dummy-draft-token");
  await dialog.getByLabel("站点用户 ID（选填）", { exact: true }).fill("42");
  for (const accept of [false, true]) {
    const nextDialog = page.waitForEvent("dialog");
    const close = dialog.getByRole("button", { name: "关闭设置", exact: true }).click();
    const confirmation = await nextDialog;
    expect(confirmation.type()).toBe("confirm");
    expect(confirmation.message()).toContain("未保存");
    expect(confirmation.message()).not.toContain("dummy-draft-token");
    if (accept) await confirmation.accept(); else await confirmation.dismiss();
    await close;
    if (!accept) {
      await expect(token).toHaveValue("dummy-draft-token");
      await expect(dialog.getByLabel("站点用户 ID（选填）", { exact: true })).toHaveValue("42");
    }
  }
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(mode).toHaveValue("password");
  await expect(dialog.getByLabel("站点账号", { exact: true })).toHaveValue("saved@example.com");
  await expect(dialog.getByLabel("站点密码", { exact: true })).toHaveValue("");
  await expect(dialog.getByText("有未保存的配置", { exact: true })).toHaveCount(0);
  await mode.selectOption("access-token");
  await expect(token).toHaveValue("");
  await expect(dialog.getByLabel("站点用户 ID（选填）", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("dummy-draft-token");
  expect(requests).toHaveLength(0);
});

test("访问令牌仅修改用户 ID 也提示未保存，放弃后恢复公开配置", async ({ page }) => {
  await mockSuppliers(page, { existing: true, siteLogin: { authMode: "access-token", configured: true, userId: "123" } });
  const requests = supplierMutations(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await dialog.getByLabel("站点用户 ID（选填）", { exact: true }).fill("456");
  await expect(dialog.getByText("有未保存的配置", { exact: true })).toBeVisible();
  const nextDialog = page.waitForEvent("dialog");
  const close = dialog.getByRole("button", { name: "关闭设置", exact: true }).click();
  const confirmation = await nextDialog;
  expect(confirmation.type()).toBe("confirm");
  expect(confirmation.message()).toContain("未保存");
  await confirmation.accept();
  await close;
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(dialog.getByLabel("登录方式", { exact: true })).toHaveValue("access-token");
  await expect(dialog.getByLabel("站点用户 ID（选填）", { exact: true })).toHaveValue("123");
  await expect(dialog.getByLabel("站点访问令牌", { exact: true })).toHaveValue("");
  await expect(dialog.getByText("有未保存的配置", { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test("访问令牌与账号密码双向保存只提交所选方式凭据", async ({ page }) => {
  const mock = await mockSuppliers(page, { existing: true, siteLogin: { authMode: "access-token", configured: true, userId: "123" } });
  const requests = supplierMutations(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  const mode = dialog.getByLabel("登录方式", { exact: true });
  await dialog.getByLabel("站点访问令牌", { exact: true }).fill("dummy-abandoned-token");
  await mode.selectOption("password");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByText("更换登录方式或连接地址时，请重新填写站点账号与密码。", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await dialog.getByLabel("站点账号", { exact: true }).fill("updated@example.com");
  await dialog.getByLabel("站点密码", { exact: true }).fill("dummy-password");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByLabel("站点密码", { exact: true })).toHaveValue("");
  expect(requests.at(-1)?.body.siteLogin).toEqual({ username: "updated@example.com", password: "dummy-password" });
  expect(mock.suppliers()[0]?.siteLogin).toEqual({ configured: true, username: "updated@example.com" });
  await dialog.getByLabel("站点密码", { exact: true }).fill("dummy-abandoned-password");
  await mode.selectOption("access-token");
  await expect(dialog.getByLabel("站点访问令牌", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("站点用户 ID（选填）", { exact: true })).toHaveValue("");
  await dialog.getByLabel("站点访问令牌", { exact: true }).fill("dummy-selected-token");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByLabel("站点访问令牌", { exact: true })).toHaveValue("");
  expect(requests.at(-1)?.body.siteLogin).toEqual({ authMode: "access-token", accessToken: "dummy-selected-token" });
  expect(mock.suppliers()[0]?.siteLogin).toEqual({ authMode: "access-token", configured: true });
});

test("访问令牌更换连接来源必须重输，不向新地址复用已保存令牌", async ({ page }) => {
  await mockSuppliers(page, { existing: true, siteLogin: { authMode: "access-token", configured: true, userId: "123" } });
  const requests = supplierMutations(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  const token = dialog.getByLabel("站点访问令牌", { exact: true });
  const api = dialog.getByLabel("API 地址", { exact: true });
  await api.fill("https://other-fixture.example.com/v1");
  await expect(token).toHaveAttribute("placeholder", "请输入站点访问令牌");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByText("首次保存或更换登录方式、连接地址时，请填写站点访问令牌。", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await token.fill("dummy-new-source-token");
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(token).toHaveValue("");
  expect(requests.at(-1)?.body.siteLogin).toEqual({ authMode: "access-token", accessToken: "dummy-new-source-token", userId: "123" });
  expect(requests.at(-1)?.body.apiUrl).toBe("https://other-fixture.example.com/v1");
  await dialog.getByLabel("站点地址", { exact: true }).fill("https://new-site-fixture.example.com");
  requests.length = 0;
  await dialog.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(dialog.getByText("首次保存或更换登录方式、连接地址时，请填写站点访问令牌。", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
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
