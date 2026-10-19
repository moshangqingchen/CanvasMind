import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "./helpers/canvas-offline-test";

test("项目音频WebM的列表、播放、Range与再导入保持真实音频类型", async ({ page, request }) => {
  const repository = resolve(process.cwd(), "../../..");
  const evidence = resolve(repository, process.env.NEURAL_EVIDENCE_DIR!);
  const environment = JSON.parse(await readFile(join(evidence, "neural-test-environment.json"), "utf8"));
  const temporary = resolve(environment.ephemeralDataRoot);
  expect(temporary.startsWith(join(repository, ".codex-temp") + sep)).toBe(true);
  const audio = spawnSync(process.env.NEURAL_FFMPEG_PATH!, ["-v", "error", "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
    "-t", "0.2", "-c:a", "libopus", "-f", "webm", "pipe:1"], { windowsHide: true, maxBuffer: 1024 * 1024 });
  expect(audio.status, audio.stderr?.toString()).toBe(0);
  const title = `音频WebM-${Date.now()}`;
  const response = await request.post("/api/projects", { data: { title } });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  const directory = join(temporary, "projects", title, "草稿", "音频");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "voice.webm"), audio.stdout);
  let generation = 0;
  await page.route("**/api/runs", route => {
    if (route.request().method() === "POST") { generation++; return route.abort(); }
    return route.continue();
  });
  const listed = await request.get(`/api/projects/${project.id}/files`);
  expect(listed.ok()).toBe(true);
  const { files } = await listed.json();
  expect(files).toHaveLength(1);
  const file = files[0];
  expect(file).toMatchObject({ kind: "audio", mimeType: "audio/webm", name: "voice.webm" });
  for (const method of ["get", "head"] as const) {
    const content = await request[method](file.contentUrl);
    expect(content.headers()["content-type"]).toContain("audio/webm");
    if (method === "get") expect(await content.body()).toEqual(audio.stdout);
  }
  const range = await request.get(file.contentUrl, { headers: { Range: "bytes=0-15" } });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-type"]).toContain("audio/webm");
  expect(await range.body()).toEqual(audio.stdout.subarray(0, 16));
  await page.goto(`/canvas/${project.id}`);
  await page.getByRole("button", { name: "项目文件", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "项目文件", exact: true });
  await panel.getByRole("tab", { name: /^草稿/u }).click();
  await panel.getByRole("button", { name: "预览 voice.webm", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "项目文件预览", exact: true });
  await expect(preview.locator("audio")).toBeVisible();
  await expect(preview.locator("video")).toHaveCount(0);
  await expect.poll(() => preview.locator("audio").evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(0);
  const imported = await request.post(`/api/projects/${project.id}/files/import`, { data: { fileIds: [file.fileId] } });
  expect(imported.ok()).toBe(true);
  const result = await imported.json();
  expect(result.assets[0]).toMatchObject({ kind: "audio", mimeType: "audio/webm" });
  const original = await request.get(`/api/assets/${result.assets[0].id}/content`);
  expect(original.headers()["content-type"]).toContain("audio/webm");
  expect(await original.body()).toEqual(audio.stdout);
  expect(generation).toBe(0);
});
