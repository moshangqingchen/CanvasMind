import { expect, test, type APIRequestContext } from "@playwright/test";
import { cangyuanMusicModel } from "@super-canvas/providers";

type Graph = { nodes: Array<{ id: string; data: Record<string, unknown> }>; edges: Array<Record<string, unknown>> };
async function graph(request: APIRequestContext, id: string): Promise<Graph> {
  const response = await request.get(`/api/canvas/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).graph;
}
async function create(request: APIRequestContext, nodes: unknown[]) {
  const response = await request.post("/api/canvas", { data: { title: "音乐工作流 mock 验收", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] } } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

test("音乐入口、Ctrl+K 与官方歌曲参数可编辑并持久化，界面操作不提交生成", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const model = cangyuanMusicModel({ id: "lyria-3-pro", name: "Lyria 3 Pro", operations: [] });
  const connection = { id: "music-ui-fixture", name: "沧元音乐界面 mock", provider: "rest", apiKeySet: true, apiKeyUsable: true, apiKey: "", config: {
    supplierKey: "cangyuan", preset: "cangyuan-gpt-image-2", usage: "canvas", baseUrl: "https://ai.cangyuansuanli.cn", modelGroup: "全模型", accountKeyGroup: "全模型", defaultModel: model.id,
    modelScanStatus: "live", scannedModelIds: [model.id], modelCatalogModels: [model], connector: { auth: { type: "bearer" }, models: [model], restrictModels: true, submit: { path: "/v1/images/generations", method: "POST" }, output: { path: "$.data", kind: "image" } },
  } };
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.fulfill({ json: [connection] }));
  await page.route("**/api/providers/music-ui-fixture/models**", route => route.fulfill({ json: [model], headers: { "X-Model-Scan-Status": "live" } }));
  let generations = 0;
  await page.route("**/api/runs", route => { if (route.request().method() === "POST") { generations++; return route.abort(); } return route.continue(); });
  const id = await create(request, [{ id: "start", type: "workflow", position: { x: 80, y: 100 }, data: { nodeType: "prompt", label: "起点灵感", parts: [{ type: "text", text: "一段舒缓的钢琴音乐" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } }]);
  await page.goto(`/canvas/${id}`);
  await page.getByRole("button", { name: "新建音乐节点", exact: true }).click();
  const music = page.locator(".react-flow__node").filter({ has: page.getByRole("button", { name: "打开 音乐生成 模型与参数", exact: true }) });
  await expect(music).toHaveCount(1);
  await music.getByRole("button", { name: "打开 音乐生成 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "音乐生成 模型与参数", exact: true });
  await expect(panel.getByLabel("纯音乐", { exact: true })).not.toBeChecked();
  await panel.getByLabel("作品名", { exact: true }).fill("晨光");
  const lyrics = panel.getByLabel("歌词", { exact: true });
  await expect(lyrics).toHaveAttribute("rows", "6");
  await lyrics.fill("[Verse]\n晨光照进窗\n[Chorus]\n一起出发");
  await panel.getByLabel("目标时长（秒）", { exact: true }).fill("90");
  await panel.getByLabel("节奏 BPM", { exact: true }).fill("72");
  await panel.getByLabel("音频格式", { exact: true }).selectOption("wav");
  await expect.poll(async () => (await graph(request, id)).nodes.find(node => node.data.nodeType === "music-generation")?.data.parameters).toMatchObject({ instrumental: false, title: "晨光", duration: 90, bpm: 72, audio_format: "wav", lyrics: "[Verse]\n晨光照进窗\n[Chorus]\n一起出发" });
  await page.reload();
  const restored = page.locator(".react-flow__node").filter({ has: page.getByRole("button", { name: "打开 音乐生成 模型与参数", exact: true }) });
  await restored.getByRole("button", { name: "打开 音乐生成 模型与参数", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "音乐生成 模型与参数" }).getByLabel("歌词", { exact: true })).toHaveValue("[Verse]\n晨光照进窗\n[Chorus]\n一起出发");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "搜索操作与节点", exact: true }).click();
  const commands = page.getByRole("dialog", { name: "快捷操作", exact: true });
  await commands.getByRole("combobox", { name: "搜索画布操作", exact: true }).fill("新建音乐节点");
  await commands.getByRole("combobox", { name: "搜索画布操作", exact: true }).press("Enter");
  await expect(commands).toBeHidden();
  await expect.poll(async () => (await graph(request, id)).nodes.filter(node => node.data.nodeType === "music-generation").length).toBe(2);
  expect(generations).toBe(0);
});

test("本地 fake 音乐生成可播放 WAV，下载入口与鉴权内容正确，刷新保留同一资产", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  const id = await create(request, [{ id: "music-local", type: "workflow", position: { x: 150, y: 160 }, style: { width: 420, height: 230 }, data: {
    nodeType: "music-generation", label: "本地 mock 音乐", provider: "fake", connectionId: "fake-default", model: "fake-music-v1", parts: [{ type: "text", text: "轻快的钢琴与弦乐" }], parameters: {},
    inputs: [{ id: "prompt", kind: "text", label: "音乐描述" }], outputs: [{ id: "audio", kind: "audio", label: "音乐" }],
  } }]);
  await page.goto(`/canvas/${id}`);
  const node = page.locator('.react-flow__node[data-id="music-local"]');
  await expect(node).toBeVisible();
  const response = page.waitForResponse(value => value.url().endsWith("/api/runs") && value.request().method() === "POST");
  await node.getByRole("button", { name: "运行 本地 mock 音乐 节点", exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(201);
  const initial = await created.json();
  await expect.poll(async () => (await (await request.get(`/api/runs/${initial.run.id}`)).json()).run.status, { timeout: 20_000 }).toBe("succeeded");
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const result = page.locator('.react-flow__node:has(.generated-result-node)');
  await expect(result).toHaveCount(1);
  const audio = result.locator("audio");
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate(element => Number.isFinite((element as HTMLAudioElement).duration) && (element as HTMLAudioElement).duration > 0)).toBe(true);
  expect(await audio.evaluate(element => (element as HTMLAudioElement).currentSrc)).toContain("/api/assets/");
  await result.locator(".generated-result-node").click({ position: { x: 20, y: 20 } });
  const actions = page.getByRole("toolbar", { name: "生成结果操作", exact: true });
  await expect(actions).toBeVisible();
  const downloadUrl = await actions.getByRole("link", { name: /^下载 /u }).getAttribute("href");
  const assetDownload = await request.get(downloadUrl!);
  expect(assetDownload.status()).toBe(200);
  expect(assetDownload.headers()["content-type"]).toContain("audio/wav");
  expect(assetDownload.headers()["content-disposition"]).toMatch(/\.wav/u);
  const downloaded = page.waitForEvent("download");
  await actions.getByRole("link", { name: /^下载 /u }).click();
  const download = await downloaded;
  // The browser harness verifies the UI target and authenticated bytes
  // independently from the native download process; the
  // packaged Electron smoke exercises actual file transfer with native auth.
  expect(download.url()).toBe(new URL(downloadUrl!, page.url()).toString());
  const bytes = await assetDownload.body();
  expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
  await expect.poll(async () => (await graph(request, id)).nodes.filter(item => item.data.generatedResult === true).length).toBe(1);
  const before = (await graph(request, id)).nodes.find(item => item.data.generatedResult === true)!;
  expect(before.data.assetKind).toBe("audio");
  await page.reload();
  await expect(page.locator(`.react-flow__node[data-id="${before.id}"] audio`)).toBeVisible();
  const after = (await graph(request, id)).nodes.filter(item => item.data.generatedResult === true);
  expect(after).toHaveLength(1);
  expect(after[0]?.data.assetId).toBe(before.data.assetId);
});
