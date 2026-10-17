import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { expectCompactPromptLine } from "./helpers/lod-expectations";
import { expect, test, type Locator, type Page } from "./helpers/canvas-offline-test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { createCanvasStateVisualFixture } from "./helpers/canvas-state-visual-fixture";
import { loadPhase3VisualAssets } from "./helpers/phase3-visual-assets";
import { clickBlankCanvas, setCanvasZoomWithWheel, waitForCanvasViewportStable } from "./canvas-test-actions";

const reference = process.env.RESTORE_REFERENCE === "1";
const theme = process.env.RESTORE_THEME === "light" ? "light" : "dark";
const output = process.env.RESTORE_OUTPUT_DIR;
const arm = reference ? "original" : theme;
test.use({ video: "off" });

async function videoBytes(page: Page) {
  // A real, short WebM test fixture, made entirely in this isolated browser.
  // No supplier, user's assets, or generated production artwork is involved.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2b5f85"; context.fillRect(0, 0, 320, 180);
    context.fillStyle = "#d8d9e8"; context.fillRect(92, 50, 136, 80);
    const stream = canvas.captureStream(12), recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 350)); recorder.stop(); await done;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
  });
  return Buffer.from(bytes);
}
function node(page: Page, id: string) { return page.locator(`.react-flow__node[data-id="${id}"]`); }
async function focusNode(page: Page, id: string) {
  const head = node(page, id).locator(".node-head");
  if (await head.isVisible()) await head.click();
  else await node(page, id).locator(".node-card").click({ position: { x: 3, y: 3 } });
  await page.getByRole("button", { name: "定位所选节点", exact: true }).click();
  await waitForCanvasViewportStable(page);
}
async function rect(element: Locator) {
  return element.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
}

test("恢复画布配色：同一隔离素材与六场景双尺寸截图及回归", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => {
    try {
      localStorage.setItem("supercanvas:appearance", value);
      localStorage.setItem("super-canvas:inspector-open", "false");
    } catch { /* about:blank has an opaque origin between isolated samples. */ }
  }, theme);
  let submitted = 0, outbound = 0;
  const errors: string[] = [];
  const consoleMessages: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`); });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) { outbound++; return route.abort(); }
    if (/\/api\/(?:runs|agent\/turn)(?:\?|\/|$)/u.test(url.pathname) && route.request().method() !== "GET") { submitted++; return route.abort(); }
    return route.continue();
  });
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const visual = process.env.RESTORE_VISUAL_ASSET_DIR ? await loadPhase3VisualAssets(process.env.RESTORE_VISUAL_ASSET_DIR) : undefined;
  let videoFixture: { name: string; mimeType: string; buffer: Buffer } = { name: "restore-isolated-video.webm", mimeType: "video/webm", buffer: await videoBytes(page) };
  let videoEvidence: Record<string, unknown> = { kind: "browser-recorded-isolated-fixture" };
  if (process.env.RESTORE_VISUAL_ASSET_DIR) {
    const assets = resolve(process.env.RESTORE_VISUAL_ASSET_DIR);
    const manifest = JSON.parse(await readFile(join(assets, "..", "manifest.json"), "utf8")) as { assets: Array<{ kind: string; relativePath: string; mimeType: string; copySHA256: string }> };
    const source = manifest.assets.find(item => item.kind === "video");
    if (source) {
      const path = resolve(assets, "..", source.relativePath);
      if (!path.toLowerCase().startsWith(`${assets.toLowerCase()}${sep}`)) throw new Error("Prepared video fixture escaped assets directory");
      const bytes = await readFile(path), hash = createHash("sha256").update(bytes).digest("hex");
      expect(hash).toBe(source.copySHA256);
      videoFixture = { name: "restore-prepared-video.mp4", mimeType: source.mimeType, buffer: bytes };
      videoEvidence = { kind: "previously-prepared-read-only-video-copy", relativePath: source.relativePath, sha256: hash, bytes: bytes.length };
    }
  }
  const videoResponse = await request.post("/api/assets/upload", { multipart: { file: {
    ...videoFixture,
  } } });
  expect(videoResponse.ok()).toBeTruthy();
  const video = await videoResponse.json();
  const fixture = await createCanvasStateVisualFixture(request, visual?.previews[0]!.bytes);
  const failed = fixture.graph.nodes.find(item => item.id === "result-failed")!;
  const originalError = "Quota exceeded: the current account has exhausted its monthly usage quota for the requested output. ".repeat(12);
  failed.data.generatedError = { message: originalError, providerMessage: originalError,
    code: "insufficient_quota", type: "insufficient_quota", statusCode: 429, source: "provider_response", api: "images/edits" };
  failed.data.generatedDetails = { taskEvidence: { taskId: "restore-fixture-provider-task-20261015", status: "failed" } };
  Object.assign(fixture.snapshot.nodes.find(item => item.nodeId === "source-failed")!, {
    errorJson: failed.data.generatedError, providerTaskId: "restore-fixture-provider-task-20261015",
    taskEvidence: { taskId: "restore-fixture-provider-task-20261015", status: "failed" },
  });
  const prompt = fixture.graph.nodes.find(item => item.id === "prompt")!;
  prompt.data.parts = [{ type: "text", text: "晨光穿过树林，镜头缓慢推进。\n第二行在40%只保留DOM，不参与绘制。" }];
  fixture.graph.edges.push({ id: "restore-long-link", source: "prompt", sourceHandle: "prompt", target: "source-succeeded", targetHandle: "prompt" });
  fixture.graph.nodes.push({ id: "restore-video", type: "workflow", position: { x: 1460, y: 60 }, style: { width: 300, height: 220 },
    data: { nodeType: "asset-input", label: "实际视频缩略图", assetKind: "video", assetId: video.id,
      inputs: [], outputs: [{ id: "video", kind: "video", label: "视频" }], mediaAspectRatio: 16 / 9 } });
  await page.route(/\/api\/runs(?:\?|\/|$)/u, route => route.request().method() !== "GET" ? route.abort() :
    new URL(route.request().url()).pathname.endsWith("/events") ? route.fulfill({ contentType: "text/event-stream", body: ": isolated\n\n" }) :
      route.fulfill({ json: new URL(route.request().url()).pathname === "/api/runs" ? [fixture.snapshot] : fixture.snapshot }));
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade*", route => route.fulfill({ json: idleCatalogCheckFixture() }));
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.fulfill({ json: [fixture.connection, fixture.fake] }));
  await page.route("**/api/providers/*/models*", route => route.fulfill({ json: fixture.models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  await page.route("**/api/agent/models**", route => route.fulfill({ json: [] }));
  await page.route("**/api/agent/sessions", route => route.fulfill({ json: [] }));
  if (output) await mkdir(join(output, arm), { recursive: true });
  const capture = async (size: string, scene: string) => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(180);
    if (output) await page.screenshot({ path: join(output, arm, `${size}-${scene}.png`), animations: "allow" });
  };
  const metrics: Record<string, unknown> = {};
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    console.log(`RESTORE ${arm} ${size} begin`);
    await page.goto("about:blank");
    const storage = await page.context().newCDPSession(page);
    await storage.send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,indexeddb" });
    await storage.detach();
    await page.setViewportSize(viewport);
    const graph = { ...fixture.graph, viewport: { x: 90, y: 86, zoom: .65 } };
    expect((await request.put(`/api/canvas/${fixture.canvas.id}`, { data: { graph } })).ok()).toBeTruthy();
    await page.goto(`/canvas/${fixture.canvas.id}`);
    await expect(node(page, "prompt")).toBeVisible();
    if (await page.locator("aside.inspector").isVisible()) await page.locator(".inspector-toggle").click();
    await expect(node(page, "asset").locator("img")).toBeVisible();
    await node(page, "restore-video").locator("video").evaluate(async element => {
      const video = element as HTMLVideoElement;
      await video.play().catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 100)); video.pause();
    });
    await waitForCanvasViewportStable(page);
    metrics[size] = await page.evaluate(() => {
      const canvas = document.querySelector(".canvas-editor")!, card = document.querySelector('[data-id="source-queued"] .node-card')!;
      const style = (element: Element | null) => { if (!element) return null; const s = getComputedStyle(element); return { background: s.background, color: s.color, borderColor: s.borderColor, outline: s.outline, boxShadow: s.boxShadow }; };
      const tokens = ["--surface-canvas", "--bg", "--panel", "--panel-2", "--panel-3", "--surface-node", "--line", "--text", "--accent", "--canvas-dot-color"];
      return { theme: document.documentElement.dataset.theme, canvas: style(canvas), wrap: style(document.querySelector(".canvas-wrap")), card: style(card),
        header: style(card.querySelector(".node-head")), body: style(card.querySelector(".node-body")),
        editor: style(document.querySelector(".node-inline-editor")), promptText: style(document.querySelector(".prompt-overview, .tiptap-prompt")),
        icon: style(card.querySelector(".node-icon")), handles: [...card.querySelectorAll(".react-flow__handle")].map(handle => ({ kind: handle.getAttribute("data-port-kind"), ...style(handle) })),
        tokens: Object.fromEntries(tokens.map(name => [name, getComputedStyle(canvas).getPropertyValue(name).trim()])), nodes: [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(element => ({ id: element.dataset.id, width: element.offsetWidth, height: element.offsetHeight })) };
    });
    if (output) await writeFile(join(output, arm, "computed-palette.json"), JSON.stringify({ at: new Date().toISOString(), metrics, visual: visual?.evidence, video: videoEvidence, errors, consoleMessages, submitted, outbound }, null, 2));
    await capture(size, "01-ordinary");
    await node(page, "prompt").locator(".node-head").click();
    if (!reference) {
      await expect(page.locator('.studio-edge-motion[data-edge-id="restore-long-link"]')).toBeVisible();
      await expect(page.locator('.studio-edge-motion[data-edge-id="edge-generated-result-running"]')).toHaveCount(0);
      const alignment = await page.evaluate(() => {
        const path = document.querySelector('.react-flow__edge[data-id="restore-long-link"] .react-flow__edge-path') as SVGPathElement;
        const terminals = [...document.querySelectorAll('.studio-edge-motion[data-edge-id="restore-long-link"] .studio-edge-terminal')] as SVGCircleElement[];
        const endpoints = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())].map(point => new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!));
        return terminals.map((terminal, index) => { const center = new DOMPoint(0, 0).matrixTransform(terminal.getScreenCTM()!);
          return Math.hypot(center.x - endpoints[index]!.x, center.y - endpoints[index]!.y); });
      });
      expect(alignment).toHaveLength(2);
      for (const distance of alignment) expect(distance).toBeLessThan(2);
      metrics[`${size}-selected-edge-terminal-distance`] = alignment;
    }
    // Let the naturally animated feather reach the exposed middle of the long
    // curve, rather than capturing it while it is behind an intervening card.
    await page.waitForTimeout(reference ? 700 : 1850); await capture(size, "02-selected-flow");
    await focusNode(page, "result-failed");
    if (!reference) {
      const failure = node(page, "result-failed").locator(".generated-result-state");
      await expect(failure).toContainText("额度");
      await expect(failure.locator(".result-error-summary")).toContainText("当前渠道的可用额度已用完");
      await expect(failure.locator(".result-error-summary")).not.toContainText("余额不足");
      await expect(failure.locator(".result-error-summary")).toHaveCSS("-webkit-line-clamp", "3");
      const heading = await rect(failure.getByText("生成失败", { exact: true }));
      const badges = await node(page, "result-failed").locator(".generated-result-status").all();
      for (const badge of badges) {
        if (!await badge.isVisible()) continue;
        const box = await rect(badge);
        expect(box.right <= heading.x || box.x >= heading.right || box.bottom <= heading.y || box.y >= heading.bottom).toBe(true);
      }
      const retry = failure.getByRole("button", { name: "再次运行 失败 · 图片结果，原地替换失败结果", exact: true });
      await expect(retry).toBeVisible();
      const retryBox = await rect(retry), failureBox = await rect(node(page, "result-failed").locator(".node-card"));
      expect(retryBox.y).toBeGreaterThanOrEqual(failureBox.y); expect(retryBox.bottom).toBeLessThanOrEqual(failureBox.bottom);
      await expect(retry).toHaveCSS("background-color", theme === "dark" ? "rgb(169, 152, 255)" : "rgb(109, 80, 200)");
      const strip = await node(page, "result-failed").locator(".node-card").evaluate(element => {
        const style = getComputedStyle(element, "::before");
        return { content: style.content, position: style.position, width: style.width,
          height: parseFloat(style.height), color: style.backgroundColor, zIndex: style.zIndex,
          visibility: style.visibility, pointerEvents: style.pointerEvents };
      });
      expect(strip.content).toBe('""'); expect(strip.position).toBe("absolute"); expect(strip.width).toBe("2px");
      expect(strip.height).toBeGreaterThan(100); expect(strip.zIndex).toBe("2");
      expect(strip.color).toBe(theme === "dark" ? "rgb(252, 165, 165)" : "rgb(185, 28, 28)");
      expect(strip.visibility).toBe("visible"); expect(strip.pointerEvents).toBe("none");
      metrics[`${size}-failure-strip`] = strip;
      await expect(failure.locator("details[open]")).toHaveCount(0);
      await capture(size, "03-failure-card");
      await failure.locator("summary").filter({ hasText: "查看完整错误详情" }).click();
      await expect(failure).toContainText("insufficient_quota");
      expect(await failure.locator("dt").filter({ hasText: /^错误代码$/u }).evaluate(element => element.nextElementSibling?.textContent)).toBe("insufficient_quota");
      expect(await failure.locator("dt").filter({ hasText: /^错误类型$/u }).evaluate(element => element.nextElementSibling?.textContent)).toBe("额度不足");
      await expect(failure).toContainText("Quota exceeded: the current account has exhausted its monthly usage quota for the requested output.");
      await expect(failure.getByRole("button", { name: "复制供应商任务编号", exact: true })).toBeVisible();
    } else {
      const summary = node(page, "result-failed").locator("summary").first();
      if (await summary.count()) await summary.click();
    }
    await capture(size, "03-long-error-details");
    if (!reference) {
      const raw = node(page, "result-failed").locator(".generated-result-state pre").first();
      expect((await raw.textContent())?.trim()).toBe(originalError.trim());
      await raw.scrollIntoViewIfNeeded();
      await expect(raw).toBeInViewport({ ratio: .05 });
      const protection = await raw.evaluate(element => {
        const state = element.closest(".generated-result-state") as HTMLElement;
        const heading = state.querySelector(":scope > div > strong")?.parentElement;
        if (!heading) throw new Error("Missing failure heading");
        const box = heading.getBoundingClientRect(), card = state.getBoundingClientRect();
        const style = getComputedStyle(heading);
        const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 2);
        return { scrollTop: state.scrollTop, topDistance: Math.abs(box.top - card.top),
          position: style.position, background: style.backgroundColor, surface: getComputedStyle(state).backgroundColor,
          protectsTop: Boolean(hit && (hit === heading || heading.contains(hit))) };
      });
      expect(protection.scrollTop).toBeGreaterThan(0);
      expect(protection.position).toBe("sticky");
      expect(protection.topDistance).toBeLessThan(2);
      expect(protection.background).toBe(protection.surface);
      expect(protection.background).not.toMatch(/transparent|rgba\([^)]*,\s*0\)/u);
      expect(protection.protectsTop).toBe(true);
      metrics[`${size}-raw-heading-protection`] = protection;
      await capture(size, "03-raw-error-scrolled");
    }
    await page.getByRole("button", { name: "Fit View", exact: true }).click(); await waitForCanvasViewportStable(page);
    await focusNode(page, "result-succeeded");
    const toolbar = page.locator(".generated-result-actions");
    if (!reference) {
      await expect(toolbar).toBeVisible();
      const tops = await toolbar.locator("button,a").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
      const box = await rect(toolbar), image = await rect(node(page, "result-succeeded").locator(".node-card"));
      expect(box.bottom <= image.y + 1 || box.y >= image.bottom - 1 || box.right <= image.x + 1 || box.x >= image.right - 1).toBe(true);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(viewport.width);
      await toolbar.getByRole("button", { name: "更多结果操作", exact: true }).click();
      await expect(page.getByRole("menu", { name: "更多结果操作", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await capture(size, "04-result-one-row-toolbar");
    await page.getByRole("button", { name: "Fit View", exact: true }).click(); await waitForCanvasViewportStable(page);
    await setCanvasZoomWithWheel(page, .4); await clickBlankCanvas(page);
    if (!reference) {
      await expect(node(page, "asset").locator("img")).toBeVisible();
      await expect(node(page, "result-succeeded").locator("img")).toBeVisible();
      await expect(node(page, "restore-video").locator("video")).toBeVisible();
      await expect(node(page, "prompt").locator(".prompt-overview")).toBeVisible();
      await expectCompactPromptLine(node(page, "prompt").locator(".prompt-overview"));
      const stateDetails = page.locator(".generated-result-state > *");
      expect(await stateDetails.count()).toBeGreaterThan(0);
      expect(await stateDetails.evaluateAll(elements => elements.every(element => getComputedStyle(element).visibility === "hidden"))).toBe(true);
    }
    await capture(size, "05-forty-percent-media");
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await waitForCanvasViewportStable(page);
    await focusNode(page, "prompt");
    await setCanvasZoomWithWheel(page, .65);
    await node(page, "prompt").locator(".node-head").hover();
    if (!reference) {
      const labels = node(page, "prompt").locator(".port-label");
      for (const label of await labels.all()) {
        await expect.poll(() => label.evaluate(element => {
          const style = getComputedStyle(element);
          const label = element.getBoundingClientRect();
          const owner = element.closest(".node-card");
          const blocked = [...document.querySelectorAll(".node-card")].some(card => {
            if (card === owner) return false;
            const box = card.getBoundingClientRect();
            return label.left < box.right + 2 && label.right > box.left - 2 && label.top < box.bottom + 2 && label.bottom > box.top - 2;
          });
          if (element.getAttribute("data-label-obscured") === "true") return style.visibility === "hidden" && blocked;
          if (style.visibility !== "visible" || blocked) return false;
          return [...document.querySelectorAll(".node-card")].every(card => {
            const box = card.getBoundingClientRect();
            return Math.min(label.right, box.right) - Math.max(label.left, box.left) <= .01 ||
              Math.min(label.bottom, box.bottom) - Math.max(label.top, box.top) <= .01;
          });
        })).toBe(true);
        const title = await label.getAttribute("title");
        expect(title).toBeTruthy();
        await expect(node(page, "prompt").locator(`.react-flow__handle[title=${JSON.stringify(title)}]`)).toHaveCount(1);
      }
      expect(await labels.evaluateAll(elements => elements.filter(element => getComputedStyle(element).visibility === "visible").length)).toBeGreaterThan(0);
    }
    // Preserve the real hover for this capture instead of moving to blank space.
    if (output) await page.screenshot({ path: join(output, arm, `${size}-06-hover-ports.png`) });
  }
  if (output) await writeFile(join(output, arm, "computed-palette.json"), JSON.stringify({ at: new Date().toISOString(), metrics, visual: visual?.evidence, video: videoEvidence, errors, consoleMessages, submitted, outbound }, null, 2));
  expect(errors).toEqual([]); expect(consoleMessages).toEqual([]); expect(submitted).toBe(0); expect(outbound).toBe(0);
});
