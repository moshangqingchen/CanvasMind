import { expect, type Page } from "@playwright/test";
import type {
  ProviderConnectionView,
  ProjectSummaryView,
} from "../../lib/client-api";
import type { SupplierRecord } from "../../lib/client-suppliers";

const timestamp = "2026-10-15T09:00:00.000Z";
export const neuralProjects: ProjectSummaryView[] = [
  {
    id: "neural-autumn",
    title: "秋日品牌视觉",
    nodeCount: 8,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: timestamp,
  },
  {
    id: "neural-moon",
    title: "月光产品分镜",
    nodeCount: 5,
    createdAt: "2026-10-02T09:00:00.000Z",
    updatedAt: "2026-10-14T09:00:00.000Z",
  },
  {
    id: "neural-study",
    title: "未完成的灵感",
    createdAt: timestamp,
    updatedAt: "2026-10-13T09:00:00.000Z",
  },
];
const imageModel = {
  id: "fixture-image-2.5-4k",
  name: "测试图片模型",
  operations: ["image.generate"] as const,
  inputKinds: ["text"] as const,
  outputKinds: ["image"] as const,
  metadata: { priceLabel: "¥0.40 / 张" },
};
export const neuralSuppliers: SupplierRecord[] = ["晨星创作", "纸月模型"].map(
  (name, index) => ({
    id: `neural-supplier-${index}`,
    name,
    supplierKey: `neural-supplier-${index}`,
    kind: "openai-compatible",
    siteUrl: `https://neural-fixture-${index}.invalid`,
    apiUrl: `https://neural-fixture-${index}.invalid/v1`,
    catalog: {
      groups: [
        {
          id: "studio",
          label: "创作组",
          supplierGroupId: "007",
          source: "catalog",
          models: [
            {
              id: imageModel.id,
              name: imageModel.name,
              capability: "image",
              protocol: "openai-images",
              priceLabel: "¥0.40 / 张",
            },
            {
              id: "fixture-video-2.0",
              name: "测试视频模型",
              capability: "video",
              protocol: "openai-videos",
            },
          ],
        },
      ],
    },
    scanStatus: "live",
    scannedAt: timestamp,
    scanLastSuccessAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export const neuralConnections: ProviderConnectionView[] = [
  ...neuralSuppliers.map((supplier) => ({
    id: `connection-${supplier.id}`,
    name: `${supplier.name}连接`,
    provider: "openai",
    apiKey: "",
    apiKeySet: true,
    config: {
      supplierId: supplier.id,
      supplierKey: supplier.supplierKey,
      baseUrl: supplier.apiUrl,
      modelGroup: "studio",
      usage: "canvas",
      modelScanStatus: "live",
      modelScanCheckedAt: timestamp,
      modelScanLastSuccessAt: timestamp,
      scannedModelIds: [imageModel.id],
      modelCatalogModels: [
        {
          ...imageModel,
          operations: [...imageModel.operations],
          inputKinds: [...imageModel.inputKinds],
          outputKinds: [...imageModel.outputKinds],
        },
      ],
    },
  })),
  ...["我的即梦工作室", "灵感实验室"].map((name, index) => ({
    id: `neural-account-${index}`,
    name,
    provider: "cli",
    apiKey: "",
    apiKeySet: false,
    config: {
      usage: "canvas",
      cli: {
        version: 1,
        siteId: `fixture-${index}`,
        siteName: name,
        executable: "D:\\fixture-only\\adapter.exe",
        args: [],
        enabled: true,
        commandTimeoutMs: 30000,
        submitTimeoutMs: 60000,
        pollIntervalMs: 3000,
        taskTimeoutMs: 600000,
      },
      cliStatus: { state: index ? "login_required" : "ready" },
      modelCatalogModels: index
        ? []
        : [
            {
              id: "fixture-personal-image",
              name: "个人图片模型",
              operations: ["image.generate"],
            },
          ],
    },
  })),
];

export async function installNeuralFixture(
  page: Page,
  options: {
    projects?: ProjectSummaryView[];
    suppliers?: SupplierRecord[];
    connections?: ProviderConnectionView[];
    theme?: "dark" | "light";
    motion?: boolean;
    noWebGL?: boolean;
  } = {},
) {
  let projects = structuredClone(options.projects ?? neuralProjects);
  const suppliers = structuredClone(options.suppliers ?? neuralSuppliers);
  const connections = structuredClone(options.connections ?? neuralConnections);
  const prohibited: string[] = [],
    unexpected: string[] = [],
    mutations: string[] = [],
    createdTitles: string[] = [],
    canvasReads: string[] = [],
    errors: string[] = [];
  const sessions = new Map<
    string,
    {
      id: string;
      canvasId: string;
      title: string;
      messages: unknown[];
      plans: unknown[];
    }
  >();
  let serial = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ theme, motion, noWebGL }) => {
      if (localStorage.getItem("supercanvas:appearance") === null)
        localStorage.setItem("supercanvas:appearance", theme);
      if (localStorage.getItem("super-canvas:gentle-motion") === null)
        localStorage.setItem(
          "super-canvas:gentle-motion",
          motion ? "on" : "off",
        );
      if (noWebGL) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          ...args: Parameters<typeof original>
        ) {
          if (
            String(args[0]).startsWith("webgl") ||
            args[0] === "experimental-webgl"
          )
            return null;
          return Reflect.apply(original, this, args);
        } as typeof original;
      }
    },
    {
      theme: options.theme ?? "dark",
      motion: options.motion ?? true,
      noWebGL: options.noWebGL ?? false,
    },
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname))
      return route.continue();
    prohibited.push(`external ${url.origin}`);
    return route.abort("blockedbyclient");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    // The UI may only read existing inventories. Never turn an unexpected request
    // into a successful scan, CLI start, verification, generation or balance read.
    if (path === "/api/suppliers/catalog-upgrade" && method === "GET")
      return route.fulfill({ json: {
        revision: "neural-offline-fixture", mode: "off", phase: "complete", total: 0,
        refreshed: 0, unavailable: 0, failed: 0, updatedConnectionIds: [],
        manualConnectionIds: [], changedConnectionIds: [], priceChangedSupplierIds: [],
        nextCheckAt: null, connections: [], history: [], noticeId: null,
      } });
    if (
      /\/(?:scan|refresh|test|cli|billing)(?:\/|$)/u.test(path) ||
      (path.endsWith("/models") &&
        path.startsWith("/api/providers/") &&
        url.searchParams.get("cached") !== "1") ||
      (path.endsWith("/verification") && method !== "GET") ||
      (path === "/api/runs" && method !== "GET") ||
      path === "/api/agent/turn" ||
      /\/(?:execute|materialize|preflight)$/u.test(path)
    ) {
      prohibited.push(`${method} ${path}${url.search}`);
      return route.fulfill({
        status: 409,
        json: {
          error:
            "This isolated workspace fixture forbids active supplier and generation requests",
        },
      });
    }
    if (path === "/api/projects") {
      if (method === "GET") return route.fulfill({ json: { projects } });
      if (method === "POST") {
        const { title } = request.postDataJSON() as { title: string };
        if (projects.some((project) => project.title === title))
          return route.fulfill({
            status: 409,
            json: { error: "项目名称已存在，请换一个名称" },
          });
        const project = {
          id: `neural-created-${++serial}`,
          title,
          nodeCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        mutations.push(`POST ${path}`);
        createdTitles.push(title);
        projects.push(project);
        return route.fulfill({ status: 201, json: { project } });
      }
    }
    const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(.*))?$/u.exec(path);
    if (projectMatch) {
      const id = decodeURIComponent(projectMatch[1]!),
        suffix = projectMatch[2],
        project = projects.find((item) => item.id === id);
      if (!project)
        return route.fulfill({
          status: 404,
          json: { error: "测试画布不存在" },
        });
      if (suffix === "chat") return route.fulfill({ json: { messages: [] } });
      if (suffix === "files")
        return route.fulfill({ json: { files: [], ignoredFiles: 0 } });
      if (suffix === "open-folder" && method === "POST") {
        mutations.push(`POST ${path}`);
        return route.fulfill({ json: { opened: true } });
      }
      if (!suffix && method === "PATCH") {
        const { title } = request.postDataJSON() as { title: string };
        if (projects.some((item) => item.id !== id && item.title === title))
          return route.fulfill({
            status: 409,
            json: { error: "项目名称已存在，请换一个名称" },
          });
        project.title = title;
        mutations.push(`PATCH ${path}`);
        return route.fulfill({
          json: { project, revision: 2, folderRenamed: true },
        });
      }
      if (!suffix && method === "DELETE") {
        projects = projects.filter((item) => item.id !== id);
        mutations.push(`DELETE ${path}`);
        return route.fulfill({
          json: {
            deleted: true,
            nextProjectId: projects[0]?.id ?? null,
            folderDeleted: true,
          },
        });
      }
    }
    if (path.startsWith("/api/canvas/") && ["GET", "PUT"].includes(method)) {
      const id = decodeURIComponent(path.split("/")[3]!),
        project = projects.find((item) => item.id === id);
      if (!project)
        return route.fulfill({
          status: 404,
          json: { error: "测试画布不存在" },
        });
      if (method === "GET") canvasReads.push(path);
      else mutations.push(`PUT ${path}`);
      return route.fulfill({
        json: {
          id,
          title: project.title,
          revision: 1,
          graph: {
            schemaVersion: 1,
            nodes: [],
            edges: [],
            drawings: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      });
    }
    if (method === "GET" && path === "/api/suppliers")
      return route.fulfill({ json: suppliers });
    if (method === "GET" && path === "/api/providers")
      return route.fulfill({ json: connections });
    if (method === "GET" && path.endsWith("/verification"))
      return route.fulfill({ json: null });
    if (
      method === "GET" &&
      path.startsWith("/api/providers/") &&
      path.endsWith("/models")
    ) {
      const id = decodeURIComponent(path.split("/")[3]!);
      return route.fulfill({
        json:
          connections.find((connection) => connection.id === id)?.config
            .modelCatalogModels ?? [],
        headers: { "X-Model-Scan-Status": "live" },
      });
    }
    if (path === "/api/agent/sessions") {
      if (method === "GET")
        return route.fulfill({ json: [...sessions.values()] });
      if (method === "POST") {
        const input = request.postDataJSON() as { canvasId: string };
        const session = {
          id: `neural-session-${input.canvasId}`,
          canvasId: input.canvasId,
          title: "创作对话",
          messages: [],
          plans: [],
        };
        sessions.set(session.id, session);
        return route.fulfill({ json: session });
      }
    }
    if (method === "GET" && path.startsWith("/api/agent/sessions/"))
      return route.fulfill({ json: sessions.get(path.split("/").pop()!) });
    if (
      method === "GET" &&
      [
        "/api/assets",
        "/api/runs",
        "/api/agent/models",
        "/api/integrations/material-drops",
      ].includes(path)
    )
      return route.fulfill({ json: [] });
    if (method === "GET" && path.includes("/preview"))
      return route.fulfill({
        status: 404,
        json: { error: "No preview in fixture" },
      });
    unexpected.push(`${method} ${path}${url.search}`);
    return route.fulfill({
      status: 404,
      json: { error: `Unmocked neural API ${method} ${path}` },
    });
  });
  return {
    prohibited,
    unexpected,
    mutations,
    createdTitles,
    canvasReads,
    projects: () => projects,
    suppliers,
    connections,
    assertSafe() {
      expect(prohibited, "不得扫描、检测、同步、生成或外联").toEqual([]);
      expect(unexpected, "每个 mock 必须遵守真实读取契约").toEqual([]);
      expect(errors, "页面不得有未处理错误").toEqual([]);
    },
  };
}
