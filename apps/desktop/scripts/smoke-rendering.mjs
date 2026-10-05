import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

/** Verify both the DOM and the Electron compositor, including after a restart. */
export async function captureRenderedHome(application, page, screenshotPath, capturePath, { windowed = false, url = page?.url() } = {}) {
  if (page) {
    await page.getByRole("heading", { name: "我的画布", exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.getByRole("button", { name: "供应商与模型", exact: true }).waitFor({ state: "visible", timeout: 15000 });
  }
  // Playwright permanently marks a crashed Page. Inspect the native WebContents
  // so the same loaded-data check also works after renderer recovery.
  const projects = await application.evaluate(async ({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === url);
      if (!window) throw new Error("Homepage BrowserWindow was not found");
      const inspection = window.webContents.executeJavaScript(`(async () => {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error("Homepage project API failed: " + response.status);
        const data = await response.json();
        if (!Array.isArray(data.projects)) throw new Error("Homepage project API did not return projects");
        const byId = (a, b) => a.id.localeCompare(b.id);
        const api = data.projects.map(({ id, title }) => ({ id, title })).sort(byId);
        const visible = element => element && element.getBoundingClientRect().width > 0 &&
          element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility === "visible";
        return new Promise((resolve, reject) => {
          const deadline = Date.now() + 30000;
          const check = () => {
            const heading = document.getElementById("projects-heading");
            const settings = document.querySelector('button[aria-label="供应商与模型"]');
            const section = document.querySelector('section[aria-labelledby="projects-heading"]');
            const loading = section?.textContent.includes("正在读取你的画布");
            const alerts = [...document.querySelectorAll('[role="alert"]')].filter(visible);
            if (alerts.length) return reject(new Error("Homepage displayed an error: " + alerts.map(alert => alert.textContent).join("; ")));
            const articles = [...(section?.querySelectorAll("article") ?? [])];
            const rendered = articles.map(article => ({
              id: decodeURIComponent(article.querySelector('a[href^="/canvas/"]')?.getAttribute("href")?.slice(8) ?? ""),
              title: article.getAttribute("aria-label"),
            })).sort(byId);
            if (visible(heading) && heading.textContent.includes("我的画布") && visible(settings) &&
                !loading && articles.every(visible) && JSON.stringify(api) === JSON.stringify(rendered)) {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve({ api, rendered, articleCount: articles.length, loading: false, alerts: 0 })));
            } else if (Date.now() >= deadline) reject(new Error("Homepage projects did not finish rendering: " + JSON.stringify({ api, rendered, loading })));
            else setTimeout(check, 50);
          };
          check();
        });
      })()`);
      let timer;
      try {
        return await Promise.race([inspection, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Renderer did not answer homepage inspection")), 35000);
        })]);
      } finally { clearTimeout(timer); }
    }, url);
  if (page) await page.screenshot({ path: screenshotPath });
  const { png, ...rendering } = await application.evaluate(async ({ BrowserWindow, app }, url) => {
    const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === url);
    if (!window) throw new Error("Homepage BrowserWindow was not found");
    const capture = await window.webContents.capturePage();
    const bitmap = capture.toBitmap();
    let samples = 0, bright = 0, darkest = 255, lightest = 0;
    const colors = new Set();
    // NativeImage's bitmap is BGRA. Sample evenly across the content surface.
    for (let offset = 0; offset + 3 < bitmap.length; offset += 4 * 17) {
      const b = bitmap[offset], g = bitmap[offset + 1], r = bitmap[offset + 2];
      const light = Math.max(r, g, b);
      samples += 1;
      if (light >= 80) bright += 1;
      darkest = Math.min(darkest, light);
      lightest = Math.max(lightest, light);
      if (colors.size < 256) colors.add((r << 16) | (g << 8) | b);
    }
    return {
      png: capture.toPNG().toString("base64"),
      size: capture.getSize(), empty: capture.isEmpty(), bitmapBytes: bitmap.length,
      samples, brightFraction: samples ? bright / samples : 0,
      lightRange: lightest - darkest, sampledColors: colors.size,
      visible: window.isVisible(), offscreen: window.webContents.isOffscreen(),
      gpuDisabledBySwitch: app.commandLine.hasSwitch("disable-gpu"),
      gpuFeatures: app.getGPUFeatureStatus(),
      rendererPid: window.webContents.getOSProcessId(),
    };
  }, url);
  await writeFile(capturePath, Buffer.from(png, "base64"));
  if (!page) await writeFile(screenshotPath, Buffer.from(png, "base64"));
  assert.equal(rendering.empty, false, "Electron capturePage must return a painted surface");
  assert.ok(rendering.size.width >= 640 && rendering.size.height >= 400, "homepage capture must cover the content viewport");
  assert.ok(rendering.bitmapBytes > 0 && rendering.sampledColors > 16 && rendering.lightRange >= 40 && rendering.brightFraction > 0.003,
    `homepage compositor must paint visible content, not a uniform black surface: ${JSON.stringify(rendering)}`);
  assert.ok(rendering.rendererPid > 0, "homepage must retain a live renderer process");
  if (windowed) {
    assert.equal(rendering.visible, true, "normal-window smoke must show its isolated test window");
    assert.equal(rendering.offscreen, false, "normal-window smoke must not use offscreen rendering");
    assert.equal(rendering.gpuDisabledBySwitch, false, "normal-window smoke must use the normal GPU startup path");
  }
  return { ...rendering, projects };
}
