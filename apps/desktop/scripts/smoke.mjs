import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { smokeCustomSuppliers } from "./smoke-custom-suppliers.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createJpegWithExifThumbnailFixture } from "../renderer/app/api/assets/jpeg-test-fixture.ts";
import { captureRenderedHome } from "./smoke-rendering.mjs";
import { runWindowedSmoke } from "./smoke-windowed.mjs";
import { captureSmokeProfileDiagnostics, diagnoseFailedSmokeProfile } from "./smoke-profile-diagnostics.mjs";
const desktop = resolve(fileURLToPath(new URL("../", import.meta.url)));
const rendererRequire = createRequire(join(desktop, "renderer/package.json"));
const desktopRequire = createRequire(join(desktop, "package.json"));
const { _electron } = rendererRequire("@playwright/test");
const packaged = process.argv.includes("--packaged");
const environment = { ...process.env, ELECTRON_ENABLE_LOGGING: "0" };
delete environment.ELECTRON_RUN_AS_NODE;
const executablePath = packaged ? join(desktop, "release/win-unpacked/SuperCanvas.exe") : desktopRequire("electron");
if (process.argv.includes("--windowed")) {
  await runWindowedSmoke({ electron: _electron, executablePath, baseArgs: packaged ? [] : [desktop], environment, desktop, packaged });
} else {
const args = packaged ? ["--smoke-test", "--disable-gpu"] : [desktop, "--smoke-test", "--disable-gpu"];
if (["1.25", "1.5"].includes(process.env.SMOKE_DISPLAY_SCALE)) args.push(`--force-device-scale-factor=${process.env.SMOKE_DISPLAY_SCALE}`);
let application = await _electron.launch({ executablePath, args, env: environment, timeout: 90000 });
const report = { packaged, checks: [] };
let succeeded = false;
let restarting = false;
const profileDiagnostics = async (phase) => {
  report.profileDiagnostics ??= [];
  report.profileDiagnostics.push({ phase, checkedAt: new Date().toISOString(),
    ...(await captureSmokeProfileDiagnostics(report.profileRoot)) });
};
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "从空白开始" }).waitFor({ state: "visible", timeout: 15000 });
  const profileRoot = await application.evaluate(({ app }) => app.getPath("userData"));
  report.profileRoot = dirname(profileRoot);
  await profileDiagnostics("setup-before-duplicate");
  const duplicate = spawn(executablePath, [...args, `--smoke-profile=${report.profileRoot}`], { env: environment, windowsHide: true, stdio: "ignore" });
  const duplicateExit = once(duplicate, "exit");
  const duplicateTimeout = setTimeout(() => duplicate.kill(), 10000);
  assert.equal((await duplicateExit)[0], 0, "second instance must exit cleanly");
  clearTimeout(duplicateTimeout);
  await profileDiagnostics("setup-after-duplicate-exit");
  report.checks.push("single instance lock");
  await mkdir(join(desktop, "release"), { recursive: true });
  await page.screenshot({ path: join(desktop, "release/smoke-setup.png") });
  report.checks.push("first-run setup");
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  report.checks.push("renderer has no Node.js require access");
  await page.getByRole("button", { name: "从空白开始" }).click();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 90000 });
  await page.getByRole("heading", { name: "我的画布" }).waitFor({ timeout: 15000 }).catch(() => page.getByText("我的画布", { exact: true }).first().waitFor());
  const resizeHome = async (width, height) => {
    const bounds = await application.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(size.width, size.height);
      const [contentWidth, contentHeight] = window.getContentSize();
      return { contentWidth, contentHeight, zoom: window.webContents.getZoomFactor() };
    }, { width, height });
    // Windows may constrain the requested size to the available display. Check
    // the actual content viewport rather than assuming a physical screen size.
    await page.waitForFunction(({ contentWidth, contentHeight, zoom }) =>
      Math.abs(innerWidth * zoom - contentWidth) <= 2 &&
      Math.abs(innerHeight * zoom - contentHeight) <= 2, bounds);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const homeLayouts = [];
  try {
    for (const [width, height, screenshot] of [[1280, 800, "smoke-home-1280.png"], [1920, 1080, "smoke-home-wide.png"]]) {
      await resizeHome(width, height);
      const layout = await page.evaluate(() => {
        const main = document.querySelector("main");
        const home = main.parentElement;
        const header = home.querySelector("header");
        const brandText = header.querySelector("a strong").parentElement;
        const settings = [...header.querySelectorAll("button")].find((button) => button.textContent.includes("供应商与模型"));
        const heading = document.getElementById("workspace-heading");
        const eyebrow = heading.previousElementSibling;
        const eyebrowText = [...eyebrow.children].find((element) => element.textContent.trim());
        const projects = document.querySelector('section[aria-labelledby="projects-heading"]');
        const mainStyle = getComputedStyle(main);
        const mainWidth = main.getBoundingClientRect().width;
        return {
          viewport: { width: innerWidth, height: innerHeight },
          brandDisplay: getComputedStyle(brandText).display,
          actionsDisplay: getComputedStyle(settings.parentElement).display,
          eyebrowWidth: eyebrowText.getBoundingClientRect().width,
          eyebrowOverflow: eyebrowText.scrollWidth - eyebrowText.clientWidth,
          eyebrowHeight: eyebrowText.getBoundingClientRect().height,
          eyebrowLineHeight: parseFloat(getComputedStyle(eyebrowText).lineHeight),
          homeWidth: home.clientWidth,
          homeOverflow: home.scrollWidth - home.clientWidth,
          documentOverflow: document.documentElement.scrollWidth - innerWidth,
          mainWidth,
          mainContentWidth: mainWidth - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
          projectsWidth: projects.getBoundingClientRect().width,
        };
      });
      homeLayouts.push(layout);
      await page.screenshot({ path: join(desktop, "release", screenshot) });
      assert.equal(layout.brandDisplay, "grid", "packaged brand text must use the matching homepage stylesheet");
      assert.equal(layout.actionsDisplay, "flex", "packaged header controls must use the matching homepage stylesheet");
      assert.ok(layout.eyebrowWidth > 100, "homepage eyebrow text must not inherit the old 6px dot width");
      assert.ok(layout.eyebrowOverflow <= 1, "homepage eyebrow text must fit horizontally");
      assert.ok(layout.eyebrowHeight <= layout.eyebrowLineHeight + 1, "homepage eyebrow text must stay on one line");
      assert.ok(layout.homeOverflow <= 1 && layout.documentOverflow <= 1, "homepage must not overflow the viewport horizontally");
      assert.ok(Math.abs(layout.mainWidth - layout.homeWidth) <= 2, "homepage main must expand with the window");
      assert.ok(Math.abs(layout.projectsWidth - layout.mainContentWidth) <= 2, "project section must fill the available main content width");
    }
    report.homeLayouts = homeLayouts;
    report.checks.push("packaged homepage stylesheet matches its markup, keeps text readable and fills resized windows");
  } finally {
    await resizeHome(1440, 960);
  }
  const origin = new URL(page.url()).origin;
  assert.equal((await fetch(`${origin}/api/health`)).status, 401);
  report.checks.push("loopback token rejects unauthenticated access");
  const removedRoutes = ["/login", "/api/public-auth/login", "/api/app-update", "/api/assets/presign", "/api/assets/complete", "/api/provider-assets/removed", "/api/webhooks/fake/removed"];
  for (const path of removedRoutes) {
    const status = await page.evaluate(async (path) => (await fetch(path)).status, path);
    assert.equal(status, 404, `Removed web route must not exist: ${path}`);
  }
  report.checks.push("standalone web login, updater, cloud upload and public callback routes are absent");
  const api = async (path, body, method = "POST") => page.evaluate(async ({ path, body, method }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text}`);
    const result = JSON.parse(text);
    return result;
  }, { path, body, method });
  assert.equal((await api("/api/desktop/lifecycle")).activeRuns, 0);
  report.checks.push("packaged lifecycle hook and durability barrier");
  const referenceStatus = await page.evaluate(() => window.superCanvasDesktop.getReferenceChannel());
  assert.equal(referenceStatus.enabled, false);
  assert.equal(referenceStatus.tokenConfigured, false);
  assert.equal("tunnelToken" in referenceStatus, false);
  const disabledReference = await page.evaluate(() => window.superCanvasDesktop.saveReferenceChannel({ enabled: false, baseUrl: "" }));
  assert.equal(disabledReference.phase, "disabled");
  report.checks.push("reference channel IPC defaults off and never returns credentials");
  const graph = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [
    { id: "prompt", type: "workflow", position: { x: 0, y: 0 }, data: { nodeType: "prompt", label: "提示词", parts: [{ type: "text", text: "desktop smoke" }], outputs: [{ id: "prompt", kind: "text" }] } },
    { id: "image", type: "workflow", position: { x: 350, y: 0 }, data: { nodeType: "image-generation", label: "测试生图", provider: "fake", connectionId: "fake-default", model: "fake-image-v1", inputs: [{ id: "prompt", kind: "text", required: true }], outputs: [{ id: "image", kind: "image" }] } },
  ], edges: [{ id: "link", source: "prompt", sourceHandle: "prompt", target: "image", targetHandle: "prompt" }] };
  const canvas = await api("/api/canvas", { title: "桌面验收 中文路径", graph });
  const requestId = crypto.randomUUID();
  const submitted = await api("/api/runs", { canvasId: canvas.id, clientRequestId: requestId, scope: "all" });
  let run;
  for (let index = 0; index < 60; index++) {
    run = await api(`/api/runs/${submitted.run.id}`);
    if (!["queued", "running"].includes(run.run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(run.run.status, "succeeded", JSON.stringify(run));
  const repeated = await api("/api/runs", { canvasId: canvas.id, clientRequestId: requestId, scope: "all" });
  assert.equal(repeated.run.id, submitted.run.id);
  const imageId = run.nodes.find((node) => node.nodeId === "image").outputAssetIds[0];
  const imageSize = await page.evaluate(async (id) => (await (await fetch(`/api/assets/${id}/content`)).arrayBuffer()).byteLength, imageId);
  assert.ok(imageSize > 0);
  report.checks.push("Fake Provider generation, archival, download and idempotent resubmission");
  // This runs only against the fresh --smoke-test profile and the local Fake
  // adapter. Exercise Chromium media and Electron's authenticated download
  // path, which the browser test runner's download context does not share.
  const musicCanvas = await api("/api/canvas", { title: "桌面音乐离线验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [
      { id: "music-smoke", type: "workflow", position: { x: 150, y: 160 }, style: { width: 420, height: 230 }, data: {
        nodeType: "music-generation", label: "桌面音乐 mock", provider: "fake", connectionId: "fake-default", model: "fake-music-v1",
        parts: [{ type: "text", text: "舒缓的钢琴与弦乐" }], parameters: {}, inputs: [{ id: "prompt", kind: "text", label: "音乐描述" }], outputs: [{ id: "audio", kind: "audio", label: "音乐" }],
      } },
    ],
  } });
  await page.goto(`${origin}/canvas/${musicCanvas.id}`);
  const musicNode = page.locator('.react-flow__node[data-id="music-smoke"]');
  await musicNode.waitFor({ state: "visible", timeout: 30000 });
  const musicResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST");
  await musicNode.getByRole("button", { name: "运行 桌面音乐 mock 节点", exact: true }).click();
  const musicSubmission = await musicResponse;
  assert.equal(musicSubmission.status(), 201, "packaged UI must submit the isolated fake music node");
  const musicInitial = await musicSubmission.json();
  let musicRun;
  for (let attempt = 0; attempt < 60; attempt++) {
    musicRun = await api(`/api/runs/${musicInitial.run.id}`);
    if (!["queued", "running"].includes(musicRun.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(musicRun.run.status, "succeeded", JSON.stringify(musicRun));
  const musicOutput = musicRun.nodes.find(node => node.nodeId === "music-smoke");
  assert.equal(musicOutput.request.provider, "fake", "desktop music smoke must never use a paid supplier");
  const musicId = musicOutput.outputAssetIds[0];
  const musicAsset = await api(`/api/assets/${musicId}`);
  assert.equal(musicAsset.kind, "audio");
  assert.equal(musicAsset.mimeType, "audio/wav");
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const musicResult = page.locator('.react-flow__node:has(.generated-result-node audio)');
  await musicResult.waitFor({ state: "visible", timeout: 15000 });
  const musicAudio = musicResult.locator("audio");
  await page.waitForFunction(() => {
    const audio = document.querySelector(".generated-result-node audio");
    return audio instanceof HTMLAudioElement && audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0;
  }, undefined, { timeout: 15000 });
  const musicPlayback = await musicAudio.evaluate(async audio => {
    audio.loop = true;
    await audio.play();
    return { duration: audio.duration, controls: audio.controls, src: audio.currentSrc };
  });
  await page.waitForFunction(() => {
    const audio = document.querySelector(".generated-result-node audio");
    return audio instanceof HTMLAudioElement && !audio.paused && audio.currentTime > 0;
  }, undefined, { timeout: 10000 });
  await musicAudio.evaluate(audio => { audio.pause(); audio.loop = false; });
  assert.equal(musicPlayback.controls, true);
  assert.equal(new URL(musicPlayback.src).origin, origin, "audio playback must use the authenticated local archive");
  report.musicPlayback = { duration: musicPlayback.duration, controls: musicPlayback.controls };
  await application.evaluate(({ BrowserWindow }, assetId) => {
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    globalThis.__musicSmokeDownload = null;
    const listener = (_event, item) => {
      const url = new URL(item.getURL());
      if (url.pathname !== `/api/assets/${assetId}/content` || url.searchParams.get("download") !== "1") return;
      globalThis.__musicSmokeDownload = { state: "progressing", filename: item.getFilename() };
      item.once("done", (_event, state) => {
        globalThis.__musicSmokeDownload = { state, filename: item.getFilename(), path: item.getSavePath(), receivedBytes: item.getReceivedBytes(), mimeType: item.getMimeType() };
      });
    };
    globalThis.__musicSmokeDownloadListener = listener;
    session.on("will-download", listener);
  }, musicId);
  let musicDownload;
  try {
    await musicResult.locator(".generated-result-node").click({ position: { x: 15, y: 12 } });
    await page.getByRole("toolbar", { name: "生成结果操作", exact: true }).getByRole("link", { name: /^下载 /u }).click();
    for (let attempt = 0; attempt < 100; attempt++) {
      musicDownload = await application.evaluate(() => globalThis.__musicSmokeDownload);
      if (musicDownload && musicDownload.state !== "progressing") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(musicDownload?.state, "completed", `Electron music download must complete: ${JSON.stringify(musicDownload)}`);
    assert.match(musicDownload.filename, /\.wav$/u);
    const musicBytes = await readFile(musicDownload.path);
    assert.equal(musicBytes.byteLength, musicAsset.size);
    assert.equal(musicDownload.receivedBytes, musicBytes.byteLength);
    assert.equal(musicBytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(musicBytes.subarray(8, 12).toString(), "WAVE");
    report.musicDownload = { state: musicDownload.state, filename: musicDownload.filename, bytes: musicBytes.byteLength };
  } finally {
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.session.removeListener("will-download", globalThis.__musicSmokeDownloadListener);
      delete globalThis.__musicSmokeDownloadListener;
      delete globalThis.__musicSmokeDownload;
    });
  }
  await page.getByRole("button", { name: "画布自动保存状态" }).filter({ hasText: "已保存" }).waitFor({ timeout: 15000 });
  report.checks.push("packaged fake music generation, local audio playback and completed Electron WAV download");
  const reviewedImage = await api(`/api/assets/${imageId}/design-review`, {
    status: "approved", note: "桌面图片设计验收：保留这一版", expectedRevision: 0,
  }, "PATCH");
  assert.equal(reviewedImage.metadata.imageDesignReview.status, "approved");
  assert.equal(reviewedImage.metadata.imageDesignReview.revision, 1);
  report.checks.push("image design review persists through the authenticated desktop API");
  const png = (await readFile(join(desktop, "dist/icon.png"))).toString("base64");
  const uploaded = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const form = new FormData(); form.set("file", new File([bytes], "桌面上传.png", { type: "image/png" }));
    const response = await fetch("/api/assets/upload", { method: "POST", body: form });
    const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body)); return body;
  }, png);
  assert.equal(uploaded.name, "桌面上传.png");
  report.checks.push("native sharp dependency and image upload");
  const exifFixture = await createJpegWithExifThumbnailFixture();
  const jpegUpload = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const response = await fetch('/api/assets/upload?name=exif-thumbnail.jpg', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: bytes });
    const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body)); return body;
  }, Buffer.from(exifFixture.bytes).toString('base64'));
  assert.equal(jpegUpload.size, exifFixture.bytes.length, 'EXIF thumbnail must not truncate the main JPEG');
  const jpegPreviews = await page.evaluate(async (id) => {
    const sizes = [];
    for (const size of [160, 640]) {
      const response = await fetch(`/api/assets/${id}/preview?size=${size}`);
      if (!response.ok) throw new Error(`JPEG preview failed: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      sizes.push({ width: bitmap.width, height: bitmap.height }); bitmap.close();
    }
    return sizes;
  }, jpegUpload.id);
  assert.deepEqual(jpegPreviews[1], { width: exifFixture.width, height: exifFixture.height });
  assert.ok(jpegPreviews[0].width > 0 && jpegPreviews[0].width <= 160);
  report.checks.push('EXIF thumbnail JPEG imports without data loss and both desktop thumbnail sizes decode');
  await page.goto(`${origin}/canvas/${canvas.id}`);
  await page.locator('.react-flow__node[data-id="prompt"]').waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "画布自动保存状态" }).filter({ hasText: "已保存" }).waitFor({ timeout: 15000 });
  const finishedDownloadStatus = await page.evaluate(async (id) => {
    const response = await fetch(`/api/assets/${id}/content?download=1`);
    await response.arrayBuffer();
    return response.status;
  }, imageId);
  assert.equal(finishedDownloadStatus, 200, "existing fake image must archive as a project finished file");
  const projectFilesResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/projects/${canvas.id}/files` && response.request().method() === "GET");
  await page.getByRole("button", { name: "打开项目文件", exact: true }).click();
  const projectFilesDialog = page.getByRole("dialog", { name: "项目文件", exact: true });
  await projectFilesDialog.waitFor();
  const filesResponse = await projectFilesResponse;
  assert.equal(filesResponse.status(), 200, "packaged project files API must load the current project");
  const projectFiles = await filesResponse.json();
  const finishedFile = projectFiles.files.find((file) => file.section === "finished" && file.assetId === imageId);
  assert.ok(finishedFile, "project files must list the archived fake image under finished files");
  assert.equal(await projectFilesDialog.getByRole("tab", { name: /^成品/ }).getAttribute("aria-selected"), "true");
  const finishedThumbnail = projectFilesDialog.locator(`article[data-file-id="${finishedFile.fileId}"] img`);
  await finishedThumbnail.waitFor({ state: "visible" });
  assert.equal(await finishedThumbnail.getAttribute("src"), finishedFile.previewUrl, "file grid must use the thumbnail URL");
  await page.waitForFunction((fileId) => {
    const image = document.querySelector(`article[data-file-id="${fileId}"] img`);
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }, finishedFile.fileId, { timeout: 15000 });
  await projectFilesDialog.getByRole("button", { name: "关闭项目文件", exact: true }).click();
  await projectFilesDialog.waitFor({ state: "hidden" });
  report.checks.push("project files opens from the top toolbar, loads the scoped API and decodes an archived finished thumbnail");
  assert.equal(await page.locator(".studio-edge-beam").count(), 0, "unselected desktop links must be still");
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await page.locator('.react-flow__node[data-id="prompt"] .node-title').click();
  const selectedLight = page.locator('.react-flow__edge[data-id="link"] .studio-edge-light');
  await selectedLight.waitFor({ state: "attached" });
  const flowPositions = await selectedLight.evaluate(async (element) => {
    const positions = [];
    for (let frame = 0; frame < 6; frame++) {
      await new Promise(requestAnimationFrame);
      positions.push(getComputedStyle(element).offsetDistance);
    }
    return positions;
  });
  assert.ok(new Set(flowPositions).size > 3, "selected desktop light must move continuously");
  assert.equal(await page.locator('.react-flow__edge[data-id="link"] .studio-edge-signal').evaluate((element) => getComputedStyle(element).strokeDasharray), "none");
  await page.locator(".react-flow__pane").click({ position: { x: 600, y: 700 } });
  assert.equal(await page.locator(".studio-edge-beam").count(), 0, "clearing selection must remove desktop light");
  report.checks.push("selected connections alone show continuous feathered light and clear with selection");
  await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "导出结构 JSON", exact: true }).click();
  let exported;
  for (let attempt = 0; attempt < 100; attempt++) {
    const filename = (await readdir(report.profileRoot)).find((name) => name.endsWith(".canvas.json"));
    if (filename) { try { exported = JSON.parse(await readFile(join(report.profileRoot, filename), "utf8")); break; } catch {} }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(exported, "native download must finish writing the project JSON");
  assert.equal(exported.format, "super-canvas-project-json");
  assert.ok(exported.graph.nodes.some((node) => node.id === "prompt"));
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({ name: "import.canvas.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ title: "桌面导入验收", graph })) });
  const importDialog = page.getByRole("dialog", { name: "确认替换当前画布" });
  await importDialog.waitFor();
  await importDialog.getByRole("checkbox").uncheck();
  await importDialog.getByRole("button", { name: "替换当前画布", exact: true }).click();
  await page.getByText("项目结构已导入并保存").waitFor();
  report.checks.push("project JSON export and re-import through the desktop UI");
  await api("/api/providers", {
    name: "桌面平面设计离线验收", provider: "fake", apiKey: "offline-smoke",
    config: { connector: { auth: { type: "none" }, models: [{
      id: "fake-image-v1", name: "Offline image design", operations: ["image.generate", "image.edit"],
      parameters: [{ key: "size", label: "尺寸", control: "select", valueType: "string", default: "1024x1024", options: [{ label: "方形", value: "1024x1024" }] }],
    }] } },
  });
  await page.reload();
  await page.getByRole("button", { name: "打开平面设计", exact: true }).click();
  const designStudio = page.getByRole("dialog", { name: "平面设计", exact: true });
  await designStudio.getByLabel("主标题", { exact: true }).fill("秋日活动海报");
  const customerBrief = "  客户原话完整保留\n时间：2026年10月1日\n全部条款，不得删减。  ";
  await designStudio.getByLabel("客户原文", { exact: true }).fill(customerBrief);
  await designStudio.getByRole("checkbox", { name: "自定义画面比例", exact: true }).check();
  await designStudio.getByLabel("画面宽度", { exact: true }).fill("210");
  await designStudio.getByLabel("画面高度", { exact: true }).fill("289");
  await designStudio.getByLabel("安全距离", { exact: true }).fill("7");
  await designStudio.getByRole("button", { name: "放入画布", exact: true }).click();
  await designStudio.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "画布自动保存状态" }).filter({ hasText: "已保存" }).waitFor({ timeout: 15000 });
  const designedCanvas = await api(`/api/canvas/${canvas.id}`);
  assert.ok(designedCanvas.graph.nodes.some((node) => node.data.graphicDesignBrief?.headline === "秋日活动海报"));
  const designNode = designedCanvas.graph.nodes.find((node) => node.data.graphicDesignBrief?.headline === "秋日活动海报");
  assert.equal(designNode.data.graphicDesignBrief.customerText, customerBrief);
  assert.ok(designNode.data.parts[0].text.includes(customerBrief));
  assert.ok(designNode.data.parts[0].text.includes("画面比例为 210:289。主要元素以及文字必须在居中的 203:282 范围之内"));
  report.checks.push("customer source stays verbatim with the requested 203:282 safe area in the packaged app");
  report.checks.push("poster design studio creates a configured image workflow in the packaged app");
  await page.screenshot({ path: join(desktop, "release/smoke-canvas.png") });
  await smokeCustomSuppliers(page, api, origin);
  report.checks.push("custom supplier names, rename propagation, group/model selection and saved connection identity");
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  assert.equal((await api("/api/health")).ok, true);
  report.checks.push("close hides to tray and backend remains available");
  await profileDiagnostics("before-normal-quit");
  const closed = application.waitForEvent("close", { timeout: 30000 });
  await application.evaluate(({ app }) => { app.quit(); });
  await closed;
  await profileDiagnostics("after-normal-quit");
  const saved = JSON.parse(await readFile(join(report.profileRoot, "profile/data/super-canvas.json"), "utf8"));
  assert.ok(saved.canvases.some((entry) => entry.id === canvas.id));
  assert.equal(saved.runs.find((entry) => entry.id === submitted.run.id).status, "succeeded");
  report.checks.push("explicit quit saves canvas, flushes database and stops backend");
  assert.equal(errors.length, 0, errors.join("\n"));
  report.checks.push("no renderer exceptions");
  const closedService = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
  assert.equal(closedService, false);
  restarting = true;
  await profileDiagnostics("before-profile-restart");
  application = await _electron.launch({ executablePath, args: [...args, `--smoke-profile=${report.profileRoot}`], env: environment, timeout: 90000 });
  await profileDiagnostics("profile-restart-launched");
  const reopened = await application.firstWindow();
  const restartErrors = [];
  reopened.on("pageerror", error => restartErrors.push(error.message));
  await reopened.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 90000 });
  await profileDiagnostics("profile-restart-home-ready");
  report.restartRendering = await captureRenderedHome(application, reopened,
    join(desktop, "release/smoke-home-restart.png"), join(desktop, "release/smoke-home-restart-capture.png"));
  report.checks.push("existing profile restarts into a visible homepage with nonempty Electron paint");
  assert.equal(new URL(reopened.url()).origin, origin, "reuse the available port so browser drafts keep their origin");
  const reopenedData = await reopened.evaluate(async () => {
    const response = await fetch("/api/projects"); const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${location.origin} ${response.url}: ${text}`);
    return JSON.parse(text);
  });
  assert.ok(reopenedData.projects.some((project) => project.id === canvas.id));
  const persistedImage = await reopened.evaluate(async (id) => (await (await fetch(`/api/assets/${id}/content`)).arrayBuffer()).byteLength, imageId);
  assert.equal(persistedImage, imageSize);
  const reopenedReview = await reopened.evaluate(async (id) => {
    const response = await fetch(`/api/assets/${id}`);
    if (!response.ok) throw new Error(`Cannot read image review: ${response.status}`);
    return (await response.json()).metadata.imageDesignReview;
  }, imageId);
  assert.equal(reopenedReview.status, "approved");
  assert.equal(reopenedReview.note, "桌面图片设计验收：保留这一版");
  assert.equal(reopenedReview.revision, 1);
  report.checks.push("image review status and notes survive a desktop restart");
  const reopenedDesign = await reopened.evaluate(async (id) => {
    const response = await fetch(`/api/canvas/${id}`);
    if (!response.ok) throw new Error(`Cannot read design canvas: ${response.status}`);
    return response.json();
  }, canvas.id);
  assert.ok(reopenedDesign.graph.nodes.some((node) => node.data.graphicDesignBrief?.headline === "秋日活动海报"));
  const restoredBrief = reopenedDesign.graph.nodes.find((node) => node.data.graphicDesignBrief?.headline === "秋日活动海报").data.graphicDesignBrief;
  assert.equal(restoredBrief.customerText, customerBrief);
  assert.deepEqual(restoredBrief.layout, { enabled: true, width: "210", height: "289", safety: "7" });
  report.checks.push("structured poster design requirements survive a desktop restart");
  report.checks.push("restart reuses DPAPI key, database and archived media");
  assert.equal(restartErrors.length, 0, restartErrors.join("\n"));
  report.checks.push("no renderer exceptions after restart");
  await profileDiagnostics("before-restart-normal-quit");
  const finalClose = application.waitForEvent("close", { timeout: 30000 });
  await application.evaluate(({ app }) => { app.quit(); });
  await finalClose;
  await profileDiagnostics("after-restart-normal-quit");
  succeeded = true;
} catch (error) {
  report.error = error.stack;
  if (restarting) {
    await profileDiagnostics("profile-restart-failed");
    let timer;
    try {
      report.restartProfileDiagnostic = await Promise.race([
        application.evaluate(diagnoseFailedSmokeProfile, report.profileRoot)
          .catch(() => ({ stage: "evaluation", status: "unavailable", available: null })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ stage: "evaluation", status: "timeout", available: null }), 5000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  const page = await application.firstWindow().catch(() => null);
  if (page && !page.isClosed()) {
    report.visibleText = await page.locator("body").innerText().catch(() => "");
    await page.screenshot({ path: join(desktop, "release/smoke-failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(join(desktop, "release/smoke-report.json"), JSON.stringify(report, null, 2));
  if (!succeeded) await application.evaluate(({ app }) => app.exit(1)).catch(() => {});
  console.log(JSON.stringify(report));
}
}
