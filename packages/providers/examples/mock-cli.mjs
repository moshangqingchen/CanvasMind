#!/usr/bin/env node
/**
 * Offline protocol v1 reference adapter. This is not a Jimeng integration.
 * It copies fixed test media and never logs in, calls a website, or spends credits.
 * Run with an absolute Node executable path and this script as a fixed argument.
 */
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scenario = process.argv.find(argument => argument.startsWith("--scenario="))?.slice(11) ?? "normal";
const respond = data => process.stdout.write(JSON.stringify({ version: 1, ok: true, data }) + "\n");
const fail = (code, message) => process.stdout.write(JSON.stringify({ version: 1, ok: false, error: { code, message } }) + "\n");
const models = [
  {
    id: "mock-video-v1", name: "模拟视频 · 固定测试片段", provider: "cli",
    operations: ["video.generate", "video.image-to-video"],
    inputKinds: ["text", "image[]"], outputKinds: ["video"],
    description: "仅验证 CLI 接口；返回固定 1 秒蓝色视频，不根据提示词生成。",
    metadata: { cliMock: true, inputRoles: ["reference", "firstFrame", "lastFrame"] },
    limits: { maxInputImages: 3, maxInputVideos: 0, maxInputAudios: 0, maxInputAssets: 3 },
    parameters: [
      { key: "resolution", label: "分辨率", control: "select", valueType: "string", required: true, default: "480p", options: [{ label: "480p（演示）", value: "480p" }, { label: "720p（演示）", value: "720p" }] },
      { key: "duration", label: "秒数", control: "select", valueType: "integer", required: true, default: 2,
        options: [{ label: "2 秒（演示）", value: 2 }, { label: "4 秒（演示）", value: 4 }],
        constraints: [{ when: [{ parameter: "resolution", values: ["720p"] }], options: [{ label: "2 秒（演示）", value: 2 }] }] },
      { key: "aspectRatio", label: "画面比例", control: "select", valueType: "string", required: true, default: "16:9", options: [{ label: "16:9", value: "16:9" }, { label: "9:16", value: "9:16" }] },
      { key: "generateAudio", label: "生成声音（参数演示）", control: "toggle", valueType: "boolean", default: false },
    ],
  },
  {
    id: "mock-image-v1", name: "模拟图片 · 固定测试像素", provider: "cli",
    operations: ["image.generate", "image.edit"], inputKinds: ["text", "image[]"], outputKinds: ["image"],
    description: "仅验证图片接口；返回固定测试 PNG。", metadata: { cliMock: true, inputRoles: ["reference"] },
    limits: { maxInputImages: 1, maxInputVideos: 0, maxInputAudios: 0 },
    parameters: [{ key: "quality", label: "质量", control: "select", valueType: "string", default: "standard", required: true, options: [{ label: "标准（演示）", value: "standard" }] }],
  },
];

try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk.toString("utf8");
  const message = JSON.parse(input);
  if (message.version !== 1) throw new Error("Unsupported protocol version");
  if (scenario === "invalid-json") { process.stdout.write("not JSON"); process.exit(0); }
  if (scenario === "exit") { process.stderr.write("access_token=example-private-secret password=example-password\n"); process.exit(2); }
  if (scenario === "large-output") { process.stdout.write("x".repeat(3 * 1024 * 1024)); process.exit(0); }
  if (scenario === "timeout" || (scenario === "submit-timeout" && message.action === "submit")) await new Promise(resolve => setTimeout(resolve, 60_000));
  if (scenario === "login-required") { fail("LOGIN_REQUIRED", "模拟账号登录已失效，请在原 CLI 中重新登录"); process.exit(0); }
  const supportsCancel = scenario !== "no-cancel";
  if (message.action === "test") respond({ ready: true, supportsCancel, message: "模拟 CLI 已就绪；不会访问真实网站" });
  else if (message.action === "describe") respond({ models, supportsCancel });
  else {
    const directory = message.context.jobDirectory;
    const outputDirectory = message.context.outputDirectory;
    if (!directory || !outputDirectory) throw new Error("Missing job context");
    const taskPath = join(directory, "mock-task.json");
    if (message.action === "submit") {
      if (scenario === "login-recovery") {
        await appendFile(join(directory, "mock-submit-attempts.txt"), "submit\n");
        try { await readFile(join(directory, "mock-login-ready")); }
        catch { fail("LOGIN_REQUIRED", "模拟账号登录已失效，请在原 CLI 中重新登录"); process.exit(0); }
      }
      let existing;
      try { existing = JSON.parse(await readFile(taskPath, "utf8")); } catch { /* First submission. */ }
      if (existing) respond({ taskId: existing.taskId, status: existing.cancelled ? "cancelled" : "queued" });
      else {
        const request = message.request;
        const model = models.find(candidate => candidate.id === request.model);
        if (!model) { fail("INVALID_PARAMETERS", "未知模拟模型"); process.exit(0); }
        if (request.parameters.resolution === "720p" && request.parameters.duration !== 2) { fail("INVALID_PARAMETERS", "720p 仅支持 2 秒"); process.exit(0); }
        const taskId = `mock-${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 20)}`;
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(taskPath, JSON.stringify({ taskId, request, polls: 0, cancelled: false }));
        if (scenario === "login-recovery") await appendFile(join(directory, "mock-created-tasks.txt"), taskId + "\n");
        respond({ taskId, status: scenario === "submit-invalid-status" ? "invalid-status" : "queued" });
      }
    } else if (message.action === "poll" || message.action === "cancel") {
      const task = JSON.parse(await readFile(taskPath, "utf8"));
      if (task.taskId !== message.taskId) throw new Error("Unknown task id");
      if (message.action === "cancel") {
        if (!supportsCancel) { fail("CANCEL_UNSUPPORTED", "此模拟连接只支持停止跟踪"); process.exit(0); }
        if (scenario === "cancel-pending") { respond({ taskId: task.taskId, status: "running", accepted: true }); process.exit(0); }
        if (scenario === "cancel-wrong-task") { respond({ taskId: "wrong-task", status: "cancelled" }); process.exit(0); }
        if (scenario === "cancel-completed") {
          await copyFile(fileURLToPath(new URL("./fixtures/sample.webm", import.meta.url)), join(outputDirectory, "mock-result.webm"));
          respond({ taskId: task.taskId, status: "succeeded", outputs: [{ kind: "video", path: join(outputDirectory, "mock-result.webm"), mimeType: "video/webm" }] });
          process.exit(0);
        }
        task.cancelled = true;
        await writeFile(taskPath, JSON.stringify(task));
        respond({ taskId: task.taskId, status: "cancelled" });
      } else if (task.cancelled) respond({ taskId: task.taskId, status: "cancelled" });
      else {
        task.polls += 1;
        await writeFile(taskPath, JSON.stringify(task));
        if (task.polls < 2 || scenario === "queued") respond({ taskId: task.taskId, status: "running", progress: 50 });
        else {
          const video = task.request.operation.startsWith("video.");
          const filename = video ? "mock-result.webm" : "mock-result.png";
          const path = scenario === "path-escape" ? join(directory, "mock-task.json") : join(outputDirectory, filename);
          if (video) await copyFile(fileURLToPath(new URL("./fixtures/sample.webm", import.meta.url)), join(outputDirectory, filename));
          else await writeFile(join(outputDirectory, filename), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHosAAAAASUVORK5CYII=", "base64"));
          respond({ taskId: task.taskId, status: "succeeded", outputs: [{ kind: video ? "video" : "image", path, filename, mimeType: video ? "video/webm" : "image/png" }] });
        }
      }
    } else fail("UNKNOWN_ACTION", "Unknown protocol action");
  }
} catch (error) {
  fail("MOCK_ERROR", error instanceof Error ? error.message : "Mock failure");
}
