import { expect, test, type Locator } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const renderer = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(renderer, "../../.."), output = resolve(root, ".codex-logs/2026-10-18-ui-readability/browser-fixture");
let server: Server, origin: string;
test.beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const { build } = require(require.resolve("esbuild", { paths: [require.resolve("vitest/package.json")] })) as { build: (options: Record<string, unknown>) => Promise<unknown> };
  await mkdir(output, { recursive: true });
  await build({ entryPoints: [resolve(renderer, "e2e/helpers/ui-readability-fixture.tsx")], bundle: true, format: "esm", platform: "browser", target: "chrome130", jsx: "automatic", outdir: output,
    loader: { ".module.css": "local-css" }, plugins: [{ name: "browser-workspace-sources", setup(builder: { onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string }): void }) {
      builder.onResolve({ filter: /^@super-canvas\// }, args => {
        const match = /^@super-canvas\/([^/]+)(?:\/(.*))?$/u.exec(args.path)!;
        return { path: resolve(root, "packages", match[1]!, "src", `${match[2] ?? "index"}.ts`) };
      });
    } }], logLevel: "silent" });
  await writeFile(resolve(output, "index.html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="ui-readability-fixture.css"><style>body{margin:0;background:var(--surface-canvas)} output{display:none}</style><div id="root"></div><script type="module" src="ui-readability-fixture.js"></script></html>');
  server = createServer(async (request, response) => {
    const path = resolve(output, `.${new URL(request.url!, "http://localhost").pathname.replace(/\/$/u, "/index.html")}`);
    if (!path.startsWith(output + sep)) { response.writeHead(403).end(); return; }
    try { response.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" })[extname(path)] ?? "application/octet-stream"); response.end(await readFile(path)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); });

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

async function bounds(locator: Locator) { const box = await locator.boundingBox(); expect(box).not.toBeNull(); return box!; }

async function expectCompactParts(compact: Locator, quote: string) {
  await expect(compact).toHaveAttribute("title", quote);
  // The rendered text, gaps between the unbreakable parts included, must match the quote verbatim.
  const parts = compact.locator("[data-price-part]"); expect(await parts.count()).toBeGreaterThan(0);
  expect(await compact.textContent()).toBe(quote);
  expect(await compact.evaluate(element => (element as HTMLElement).innerText)).toBe(quote);
  for (const part of await parts.all()) {
    await expect(part).toHaveCSS("white-space", "nowrap");
    expect(await part.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top)));
      return lines.size <= 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
  }
}

for (const theme of ["light", "dark"]) for (const width of [640, 300]) {
  test(`${theme} ${width}px 候选预览随键鼠高亮变化但保留选择、列表位置和价格语义`, async ({ page }) => {
    await page.setViewportSize({ width: width + 48, height: 900 });
    await page.goto(`${origin}/?theme=${theme}&width=${width}`);
    const picker = page.getByRole("combobox", { name: "离线图片模型", exact: true }); await picker.click();
    const menu = page.locator(".node-model-select-options"), list = page.getByRole("listbox"), search = page.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
    const preview = page.getByRole("region", { name: "价格明细", exact: true });
    const first = list.getByRole("option", { name: "GPT Image 2.5", exact: true }), second = list.getByRole("option", { name: "候选图片型号", exact: true });
    await expect(preview).toContainText("gpt-image-2.5");
    const initialMenu = await bounds(menu), initialList = await bounds(list);
    const lastRow = await bounds(list.getByRole("option").last());
    expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(initialList.y + initialList.height + 1);
    await second.hover(); await expect(preview).toContainText("comparison-image"); await expect(preview.getByRole("cell", { name: "4.4", exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("已选择型号")).toHaveText("gpt-image-2.5");
    expect(Math.abs((await bounds(menu)).y - initialMenu.y)).toBeLessThanOrEqual(1); expect(Math.abs((await bounds(list)).y - initialList.y)).toBeLessThanOrEqual(1);
    await search.press("ArrowUp"); await expect(preview).toContainText("gpt-image-2.5");
    const described = await first.getAttribute("aria-describedby"); expect(described).toContain("-price");
    const priceId = described!.split(" ").find(value => value.endsWith("-price"))!;
    await expect(page.locator(`[id="${priceId}"]`)).toContainText("0.025–0.44 CNY / 张");
    await expectCompactParts(first.locator("[data-price-compact]"), "0.025–0.44 CNY / 张 · 20 档");
    const scroll = preview.getByLabel("滚动价格明细");
    expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight && element.clientHeight > 40 && element.clientHeight <= 220)).toBe(true);
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; }); await expect(preview.getByRole("table", { name: "系列 sunburst价格档位", exact: true })).toBeVisible();
    await list.getByRole("option", { name: "单价图片型号", exact: true }).hover(); await expect(preview).toHaveCount(0);
    await list.getByRole("option", { name: "空价格图片型号", exact: true }).hover(); await expect(preview).toHaveCount(0);
    expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}

test("300px 虚拟长列表保留完整选项和分页，参数面板与供应商明细都保留事实", async ({ page }) => {
  await page.setViewportSize({ width: 348, height: 760 });
  await page.goto(`${origin}/?width=300&many=1`); await page.getByRole("combobox", { name: "离线图片模型", exact: true }).click();
  const menu = page.locator(".node-model-select-options"), list = page.getByRole("listbox");
  const item = list.getByRole("option").first(); await expect(item).toHaveAttribute("aria-setsize", "45");
  const listBox = await bounds(list), itemBox = await bounds(item); expect(listBox.height).toBeGreaterThanOrEqual(itemBox.height - 1);
  await expect(menu.getByRole("button", { name: "下一页", exact: true })).toBeVisible(); await menu.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-posinset", "41");
  expect(await menu.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 11 && box.bottom <= innerHeight - 11; })).toBe(true);
  await page.goto(`${origin}/?width=300&view=panel`);
  const quote = page.getByRole("region", { name: "型号报价", exact: true });
  await expect(quote.getByRole("cell").filter({ hasText: "当前参数" })).toContainText("0.44"); await expect(quote).toContainText("其余质量"); await expect(quote).toContainText("其余档位");
  await page.goto(`${origin}/?width=300&view=supplier`);
  const rows = page.locator(".sm-model-item"); await rows.nth(0).getByText("查看依据", { exact: true }).click(); await expect(rows.nth(0)).toContainText("/v1/images/generations");
  await rows.nth(1).getByText("价格明细", { exact: true }).click();
  const token = rows.nth(1).getByRole("table", { name: "Token 单价", exact: true }); await expect(token).toContainText("USD / 1M tokens");
  for (const [label, amount] of [["输入", "2"], ["输出", "8"], ["图片输出", "32"]]) await expect(token.getByRole("row", { name: `${label} ${amount}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const placement of ["above", "below"]) test(`${placement} 菜单多档与单价候选互换时保持菜单及列表顶部`, async ({ page }) => {
  await page.setViewportSize({ width: 348, height: 900 });
  await page.goto(`${origin}/?width=300`);
  if (placement === "above") await page.locator("main").evaluate(element => { element.style.marginTop = "620px"; });
  await page.getByRole("combobox", { name: "离线图片模型", exact: true }).click();
  const menu = page.locator(".node-model-select-options"), list = page.getByRole("listbox");
  const preview = page.getByRole("region", { name: "价格明细", exact: true });
  await expect(preview).toBeVisible();
  const initialMenu = await bounds(menu), initialList = await bounds(list);
  await list.getByRole("option", { name: "单价图片型号", exact: true }).hover(); await expect(preview).toHaveCount(0);
  expect(Math.abs((await bounds(menu)).y - initialMenu.y)).toBeLessThanOrEqual(1);
  expect(Math.abs((await bounds(list)).y - initialList.y)).toBeLessThanOrEqual(1);
  await list.getByRole("option", { name: "GPT Image 2.5", exact: true }).hover(); await expect(preview).toBeVisible();
  expect(Math.abs((await bounds(menu)).y - initialMenu.y)).toBeLessThanOrEqual(1);
  expect(Math.abs((await bounds(list)).y - initialList.y)).toBeLessThanOrEqual(1);
  await expect(page.getByLabel("已选择型号")).toHaveText("gpt-image-2.5");
});

for (const theme of ["light", "dark"]) for (const width of [640, 300]) {
  test(`${theme} ${width}px 标识仅在路径斜线后换行或省略，完整标题与其余 tier 标签保留`, async ({ page }) => {
    await page.setViewportSize({ width: width === 640 ? 1280 : 348, height: 900 });
    for (const long of [false, true]) {
      await page.goto(`${origin}/?theme=${theme}&width=${width}&view=supplier${long ? "&longIdentifiers=1" : ""}`);
      const row = page.locator(".sm-model-item").first(); await row.getByText("查看依据", { exact: true }).click();
      await expectCompactParts(row.locator("[data-price-compact]"), "0.025–0.44 CNY / 张 · 20 档");
      await expectCompactParts(page.locator(".sm-model-item").nth(1).locator("[data-price-compact]"), "Token 计价（目录快照）");
      if (width === 640) for (const compact of await page.locator(".sm-model-price [data-price-compact]").all()) {
        expect(await compact.evaluate(element => {
          const tops = [...element.querySelectorAll("[data-price-part]")].map(part => part.getBoundingClientRect().top);
          return Math.max(...tops) - Math.min(...tops) <= 1;
        })).toBe(true);
      }
      const protocolText = long ? "openai-compatible-image-generation-with-an-extra-long-protocol-token" : "openai-images";
      const endpointText = long ? "/v1/images/generations/super_long_endpoint_segment_that_must_not_break_inside_the_word" : "/v1/images/generations";
      const protocol = row.locator(".information-identifier:not(.information-identifier-path)");
      const endpoint = row.locator(".information-identifier-path");
      await expect(protocol).toHaveAttribute("title", protocolText); await expect(protocol).toHaveText(protocolText);
      await expect(protocol).toHaveCSS("white-space", "nowrap"); await expect(protocol).toHaveCSS("text-overflow", "ellipsis");
      await expect(endpoint).toHaveAttribute("title", endpointText); await expect(endpoint).toHaveText(endpointText);
      const segments = endpoint.locator(".information-identifier-segment");
      expect(await segments.allTextContents()).toEqual(endpointText.split("/").map((segment, index, all) => `${segment}${index < all.length - 1 ? "/" : ""}`));
      for (const segment of await segments.all()) {
        await expect(segment).toHaveCSS("white-space", "nowrap"); await expect(segment).toHaveCSS("text-overflow", "ellipsis");
        expect(await segment.evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top)));
          return lines.size <= 1 && element.getBoundingClientRect().right <= element.parentElement!.getBoundingClientRect().right + 1;
        })).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto(`${origin}/?theme=${theme}&width=${width}&view=panel&rawTier=1`);
    const quote = page.getByRole("region", { name: "型号报价", exact: true });
    await expect(quote.getByRole("rowheader", { name: "其余 tier", exact: true })).toHaveCount(2);
    await expect(quote).toContainText("其余质量"); await expect(quote).not.toContainText("其余tier");
  });
}


