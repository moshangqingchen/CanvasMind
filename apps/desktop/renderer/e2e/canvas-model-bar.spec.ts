import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";

const model: ModelDescriptor = {
  id: "isolated-gpt-image-2.5-sunburst", name: "isolated-gpt-image-2.5-sunburst", operations: ["image.generate"],
  inputKinds: ["text"], outputKinds: ["image"],
  metadata: { canvasRunnable: true, priceSource: "generated-result", priceLabel: "$0.08/张（账单实测）· 4K",
    measuredPrice: { parameters: { n: 1, size: "3840x2160", quality: "max", background: "transparent" } } },
};
const screenshots = resolve(process.cwd(), "../../../.codex-logs/2026-10-16-canvas-layout/screenshots");

test("型号栏保留简短报价、完整证据提示和独立运行按钮", async ({ page, request }) => {
  expect(process.env.PLAYWRIGHT_BASE_URL).toBeFalsy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await mkdir(screenshots, { recursive: true });
  let submissions = 0, external = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      external++; return route.abort();
    }
    if (/\/api\/(?:runs|agent\/turn)(?:\?|\/|$)/u.test(url.pathname) && !["GET", "HEAD"].includes(route.request().method())) {
      submissions++; return route.abort();
    }
    return route.fallback();
  });
  const supplierResponse = await request.post("/api/suppliers", { data: {
    name: "隔离型号栏供应商", siteUrl: "https://model-bar.invalid", apiUrl: "https://model-bar.invalid",
  } });
  expect(supplierResponse.ok()).toBeTruthy();
  const supplier = await supplierResponse.json();
  const provider = await request.post("/api/providers", { data: { provider: "rest", name: "隔离型号栏", apiKey: "isolated-no-generation",
    config: { usage: "canvas", baseUrl: supplier.apiUrl, supplierId: supplier.id, supplierKey: supplier.supplierKey,
      customGroup: true, modelGroup: "隔离布局", defaultModel: model.id, connector: { auth: { type: "none" }, models: [model] } } } });
  expect(provider.ok()).toBeTruthy();
  const connection = await provider.json();
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: [model],
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  const created = await request.post("/api/canvas", { data: { title: "隔离型号栏布局验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "model-bar", type: "workflow", position: { x: 260, y: 220 }, style: { width: 360, height: 260 },
      data: { nodeType: "image-generation", label: "图片生成", provider: "rest", connectionId: connection.id,
        model: model.id, parameters: { size: "3840x2160", quality: "max" },
        parts: [{ type: "text", text: "隔离画布界面验收，仅检查布局。" }],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  await page.goto(`/canvas/${canvas.id}`);
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  await expect(inspector).toBeVisible();
  if (await inspector.getAttribute("aria-expanded") === "true") await inspector.click();
  const node = page.locator('.react-flow__node[data-id="model-bar"]');
  const bar = node.locator(".node-inline-toolbar");
  const price = bar.locator(".node-model-price");
  await bar.locator(".node-config-summary").click();
  await page.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
  await expect(price).toContainText("账单实测");
  const before = process.env.CANVAS_MODEL_BAR_BEFORE === "1";
  if (!before) {
    await expect(price).toHaveText("$0.08/张（账单实测）· 4K");
    await expect(bar.locator(".node-config-summary")).toHaveAttribute("title", /实测参数：数量=1，尺寸=3840x2160/u);
    await expect(bar.locator(".node-run-button span")).toBeVisible();
    await expect.poll(() => bar.evaluate(element => {
      const remove = element.querySelector(".node-delete-button")!.getBoundingClientRect();
      const run = element.querySelector(".node-run-button")!.getBoundingClientRect();
      return run.left - remove.right;
    })).toBeGreaterThanOrEqual(8);
  }
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const selected of [false, true]) {
      if (selected) await node.locator(".node-head").click();
      else await page.locator(".react-flow__pane").click({ position: { x: 1000, y: 600 } });
      await expect(node).toHaveClass(selected ? /\bselected\b/u : /^(?!.*\bselected\b).*$/u);
      await page.screenshot({ path: resolve(screenshots, `model-bar-${before ? "before-" : ""}${theme}-${selected ? "selected" : "unselected"}.png`) });
    }
  }
  expect({ submissions, external, errors }).toEqual({ submissions: 0, external: 0, errors: [] });
});
