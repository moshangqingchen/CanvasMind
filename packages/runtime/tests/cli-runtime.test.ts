import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { CLI_DEFAULTS, CliProviderAdapter, configFingerprint, cliJobKey, MOCK_CLI_SCRIPT_PATH, type ProviderAdapter } from "@super-canvas/providers";
import { LocalObjectStorage } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import { consumeCliArtifact } from "../src/cli-artifact.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function graph(data: JsonObject = {}) {
  return {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [],
    nodes: [{ id: "generate", type: "workflow", data: {
      nodeType: "video-generation", provider: "cli", connectionId: "personal",
      model: "mock-video", parts: [{ type: "text", text: "中文引号\"与换行\n$()`" }],
      parameters: { resolution: "720p", duration: 4 }, outputs: [{ id: "video", kind: "video" }], ...data,
    } }],
  };
}

async function fixture(data: JsonObject = {}) {
  const directory = await mkdtemp(join(tmpdir(), "canvas-cli-runtime-"));
  directories.push(directory);
  const repository = new MemoryRepository();
  const storage = new LocalObjectStorage(join(directory, "storage"));
  const cliJobRoot = join(directory, "cli-jobs");
  await repository.saveConnection({ id: "personal", provider: "cli", name: "个人测试网站", encryptedSecret: null,
    config: { cli: { version: 1, siteId: "mock", siteName: "模拟", executable: "unused", args: [], enabled: true, pollIntervalMs: 1, taskTimeoutMs: 7_200_000 } } });
  await repository.saveCanvas({ id: "canvas", title: "CLI", graph: graph(data) });
  const service = new RunService({ repository, storage, cliJobRoot, pollIntervalMs: 0 });
  const adapter: ProviderAdapter = {
    testConnection: async () => {}, listModels: async () => [], validate: async () => ({ valid: true, issues: [] }),
    submit: vi.fn(async () => ({ providerTaskId: "remote-1", status: "succeeded", result: { cli: { supportsCancel: false } } })),
    poll: vi.fn(async task => ({ ...task, status: "succeeded" })),
    extractOutputs: async () => [{ kind: "video", data: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" }],
    cancel: vi.fn(async () => {}), cleanup: vi.fn(async () => {}),
  };
  vi.spyOn(service, "adapters").mockReturnValue(new Map([["cli", adapter]]));
  return { directory, cliJobRoot, service, repository, storage, adapter };
}

async function terminal(service: RunService, runId: string) {
  await vi.waitFor(async () => expect((await service.getRun(runId))?.run.status).not.toMatch(/^(queued|running)$/), { timeout: 6000 });
  return (await service.getRun(runId))!;
}

describe("personal CLI runtime", () => {
  it("mints connection snapshots from the repository and rejects missing imported connections", async () => {
    const forged = { id: "personal", provider: "cli", name: "forged", config: { cli: { executable: "malicious" } } };
    const { service, repository } = await fixture({ __runtimeConnection: forged });
    const prepared = await service.prepareRun({ canvasId: "canvas", scope: "all" });
    expect(JSON.stringify(prepared.revisionGraph)).toContain('"executable":"unused"');
    expect(JSON.stringify(prepared.revisionGraph)).not.toContain("malicious");
    await repository.saveCanvas({ id: "canvas", graph: graph({ connectionId: "missing", __runtimeConnection: forged }) });
    await expect(service.prepareRun({ canvasId: "canvas", scope: "all" })).rejects.toThrow("重新绑定");
  });

  it("preserves declared image parameters without HTTP image-size rewriting", async () => {
    const parameters = { resolution: "native", size: "auto", size_tier: "website-native", n: 7 };
    const { service, adapter } = await fixture({ nodeType: "image-generation", parameters });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "image", scope: "all" });
    const completed = await terminal(service, run.id);
    expect(completed.run.status, JSON.stringify(completed.nodes)).toBe("succeeded");
    expect(vi.mocked(adapter.submit).mock.calls[0][0].parameters).toEqual(parameters);
  });

  it("does not retry uncertain CLI submissions and retains a returned task id", async () => {
    const { service, adapter } = await fixture();
    vi.mocked(adapter.submit).mockRejectedValue(Object.assign(new Error("登录进程断开，提交状态待确认"), { code: "CLI_ACTION_REQUIRED", providerTaskId: "known-remote" }));
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "uncertain", scope: "all" });
    const result = await terminal(service, run.id);
    expect(result.run.status).toBe("needs_attention");
    expect(result.nodes[0].providerTaskId).toBe("known-remote");
    expect(adapter.submit).toHaveBeenCalledTimes(1);
    expect(result.nodes[0].inputJson.cliDeadlineAt).toBeTypeOf("number");
  });

  it("recovers only by polling and preserves an expired deadline across services", async () => {
    const { service, repository, adapter } = await fixture();
    const prepared = await service.prepareRun({ canvasId: "canvas", scope: "all" });
    await repository.createRun({ id: "resume", canvasId: "canvas", clientRequestId: "resume", scope: "all", status: "running", revisionGraph: prepared.revisionGraph });
    const deadline = Date.now() - 1000;
    await repository.createNodeRun({ id: "node-resume", workflowRunId: "resume", nodeId: "generate", attempt: 1, status: "running", providerTaskId: "existing-id", outputAssetIds: [], errorJson: null,
      inputJson: { provider: "cli", connectionId: "personal", cliDeadlineAt: deadline, providerTask: { providerTaskId: "existing-id", status: "running", result: { cli: { supportsCancel: false } } } } });
    vi.mocked(adapter.poll!).mockImplementation(async task => ({ ...task, status: "running" }));
    await service.resumeRun("resume");
    const result = await terminal(service, "resume");
    expect(result.run.status, JSON.stringify(result.nodes)).toBe("needs_attention");
    expect(result.nodes[0].inputJson.cliDeadlineAt).toBe(deadline);
    expect(adapter.poll).toHaveBeenCalledTimes(1);
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(result.nodes[0].providerTaskId).toBe("existing-id");
  });

  it("polls and archives an existing CLI task even after the original reference asset is deleted", async () => {
    const { service, repository, adapter } = await fixture({ parts: [{ type: "text", text: "existing prompt" }, { type: "asset", assetId: "deleted-reference", role: "firstFrame" }] });
    const prepared = await service.prepareRun({ canvasId: "canvas", scope: "all" });
    await repository.createRun({ id: "deleted-input", canvasId: "canvas", clientRequestId: "deleted-input", scope: "all", status: "running", revisionGraph: prepared.revisionGraph });
    await repository.createNodeRun({ id: "existing-node", workflowRunId: "deleted-input", nodeId: "generate", attempt: 1, status: "running", providerTaskId: "existing-id", outputAssetIds: [], errorJson: null,
      inputJson: { provider: "cli", connectionId: "personal", operation: "video.image-to-video", prompt: "submitted prompt", parameters: { resolution: "720p", duration: 4 }, cliDeadlineAt: Date.now() + 60_000,
        providerTask: { providerTaskId: "existing-id", status: "running", result: { cli: { supportsCancel: false } } } } });
    const validate = vi.spyOn(adapter, "validate");
    await service.resumeRun("deleted-input");
    const result = await terminal(service, "deleted-input");
    expect(result.run.status, JSON.stringify(result.nodes)).toBe("succeeded");
    expect(result.nodes[0].inputJson.operation).toBe("video.image-to-video");
    expect(result.nodes[0].inputJson.prompt).toBe("submitted prompt");
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(adapter.poll).toHaveBeenCalledTimes(1);
  });

  it("holds an unresolved account reservation durably until the user stops tracking", async () => {
    const { service, repository, adapter, cliJobRoot, storage } = await fixture();
    vi.mocked(adapter.submit).mockRejectedValueOnce(Object.assign(new Error("提交状态未知"), { code: "CLI_ACTION_REQUIRED" }));
    const original = await service.createRun({ canvasId: "canvas", clientRequestId: "unknown-first", scope: "all" });
    expect((await terminal(service, original.id)).run.status).toBe("needs_attention");
    const restored = new RunService({ repository, storage, cliJobRoot, pollIntervalMs: 0 });
    vi.spyOn(restored, "adapters").mockReturnValue(new Map([["cli", adapter]]));
    const blocked = await restored.createRun({ canvasId: "canvas", clientRequestId: "blocked-second", scope: "all" });
    const result = await terminal(restored, blocked.id);
    expect(result.run.status).toBe("needs_attention");
    expect(result.nodes[0].errorJson?.code).toBe("cli_connection_busy");
    expect(adapter.submit).toHaveBeenCalledTimes(1);
    await restored.cancelRun(original.id);
    const cancelled = await restored.getRun(original.id);
    expect(cancelled?.nodes[0].errorJson?.message).toContain("已停止跟踪");
    const next = await restored.createRun({ canvasId: "canvas", clientRequestId: "after-stop", scope: "all" });
    expect((await terminal(restored, next.id)).run.status).toBe("succeeded");
    expect(adapter.submit).toHaveBeenCalledTimes(2);
  });

  it("reserves one connection throughout polling, across simultaneous runs", async () => {
    const { service, adapter } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(adapter.submit).mockImplementation(async request => ({ providerTaskId: request.idempotencyKey, status: "running", result: {} }));
    vi.mocked(adapter.poll!).mockImplementation(async task => { await gate; return { ...task, status: "succeeded" }; });
    const first = await service.createRun({ canvasId: "canvas", clientRequestId: "first", scope: "all" });
    await vi.waitFor(() => expect(adapter.poll).toHaveBeenCalledTimes(1));
    const second = await service.createRun({ canvasId: "canvas", clientRequestId: "second", scope: "all" });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(adapter.submit).toHaveBeenCalledTimes(1);
    release();
    expect((await terminal(service, first.id)).run.status).toBe("succeeded");
    expect((await terminal(service, second.id)).run.status).toBe("succeeded");
    expect(adapter.submit).toHaveBeenCalledTimes(2);
  });

  it("labels cancellation without remote support as stopping tracking", async () => {
    const { service, adapter } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(adapter.submit).mockResolvedValue({ providerTaskId: "uncancellable", status: "running", result: { cli: { supportsCancel: false } } });
    vi.mocked(adapter.poll!).mockImplementation(async task => { await gate; return task; });
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "stop-tracking", scope: "all" });
    await vi.waitFor(() => expect(adapter.poll).toHaveBeenCalledTimes(1));
    await service.cancelRun(run.id);
    release();
    await vi.waitFor(async () => expect((await service.getRun(run.id))?.nodes[0].status).toBe("cancelled"));
    expect((await service.getRun(run.id))?.nodes[0].errorJson?.message).toContain("已停止跟踪");
  });

  it("keeps remote cancellation pending when the active executor encounters an unconfirmed cancellation", async () => {
    const { service, adapter } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(adapter.submit).mockResolvedValue({ providerTaskId: "pending-cancel", status: "running", result: { cli: { supportsCancel: true } } });
    vi.mocked(adapter.poll!).mockImplementation(async task => { await gate; return task; });
    vi.mocked(adapter.cancel!).mockRejectedValue(new Error("网站取消请求尚未确认"));
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "cancel-pending", scope: "all" });
    await vi.waitFor(() => expect(adapter.poll).toHaveBeenCalledTimes(1));
    await service.cancelRun(run.id);
    release();
    await vi.waitFor(async () => expect((await service.getRun(run.id))?.nodes[0].errorJson?.message).toContain("远端取消暂未完成"));
    expect((await service.getRun(run.id))?.nodes[0].status).toBe("cancel_requested");
  });

  it("streams local video into storage before cleanup and preserves files when archival fails", async () => {
    const { service, repository, adapter, cliJobRoot, storage } = await fixture();
    let output = "";
    vi.mocked(adapter.submit).mockImplementation(async request => {
      const root = join(cliJobRoot, cliJobKey(request.connectionId, request.idempotencyKey), "output");
      await mkdir(root, { recursive: true });
      output = join(root, "fixture.mp4");
      await writeFile(output, new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
      return { providerTaskId: "local-video", status: "succeeded", result: { root: await realpath(root), path: await realpath(output) } };
    });
    adapter.extractOutputs = async value => [{ kind: "video", localFile: value as { root: string; path: string }, mimeType: "video/mp4" }];
    const stream = vi.spyOn(storage, "putStream");
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "local", scope: "all" });
    const result = await terminal(service, run.id);
    expect(result.run.status, JSON.stringify(result.nodes)).toBe("succeeded");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(adapter.cleanup).toHaveBeenCalledTimes(1);
    const asset = (await repository.listAssets())[0];
    expect((await storage.get(asset.storageKey))?.bytes).toEqual(await readFile(output));

    stream.mockRejectedValue(new Error("disk unavailable"));
    const failed = await service.createRun({ canvasId: "canvas", clientRequestId: "archive-failure", scope: "all" });
    const snapshot = await terminal(service, failed.id);
    expect(snapshot.run.status).toBe("needs_attention");
    expect(snapshot.nodes[0].providerTaskId).toBe("local-video");
    expect(adapter.cleanup).toHaveBeenCalledTimes(1);
    expect(await readFile(output)).toHaveLength(8);
  });

  it("rejects local files from another task before reading them", async () => {
    const { directory } = await fixture();
    const root = join(directory, "one", "output");
    const other = join(directory, "two", "output");
    await mkdir(root, { recursive: true });
    await mkdir(other, { recursive: true });
    const path = join(other, "private.mp4");
    await writeFile(path, "private");
    const consume = vi.fn(async () => {});
    await expect(consumeCliArtifact({ root: other, path }, root, 1000, consume)).rejects.toThrow("当前任务");
    await expect(consumeCliArtifact({ root, path }, root, 1000, consume)).rejects.toThrow("当前任务");
    expect(consume).not.toHaveBeenCalled();
  });

  it("runs the actual offline CLI from connection check and model sync through reference upload, polling and playable video archival", async () => {
    const { service, repository, storage, cliJobRoot, directory } = await fixture({
      model: "mock-video-v1", parameters: { resolution: "720p", duration: 2, aspectRatio: "16:9", generateAudio: false },
      parts: [{ type: "text", text: "中文 \"引号\"\n换行 $() `" }, { type: "asset", assetId: "reference", role: "firstFrame" }],
    });
    vi.mocked(service.adapters).mockRestore();
    const cwd = join(directory, "中文 空格目录");
    await mkdir(cwd);
    const config = { ...CLI_DEFAULTS, version: 1 as const, siteId: "offline", siteName: "模拟网站", enabled: true,
      executable: process.execPath, args: [MOCK_CLI_SCRIPT_PATH], cwd };
    await repository.saveConnection({ id: "personal", name: "Offline", provider: "cli", encryptedSecret: null, config: { cli: config } });
    const cli = service.adapters().get("cli") as CliProviderAdapter;
    const checked = await cli.checkConnection("personal");
    expect(checked.ready).toBe(true);
    const described = await cli.describe("personal");
    expect(described.models.map(model => model.id)).toContain("mock-video-v1");
    await repository.saveConnection({ id: "personal", name: "Offline", provider: "cli", encryptedSecret: null,
      config: { cli: config, cliStatus: { state: "ready", supportsCancel: checked.supportsCancel, configFingerprint: configFingerprint(config) }, modelCatalogModels: described.models } as unknown as JsonObject });
    const reference = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHosAAAAASUVORK5CYII=", "base64");
    await storage.put("reference.png", reference, "image/png");
    await repository.saveAsset({ id: "reference", name: "首帧.png", kind: "image", mimeType: "image/png", size: reference.byteLength, storageKey: "reference.png", metadata: {} });
    const stream = vi.spyOn(storage, "putStream");
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "real-cli", scope: "all" });
    const result = await terminal(service, run.id);
    expect(result.run.status, JSON.stringify(result.nodes)).toBe("succeeded");
    const generated = (await repository.listAssets()).find(asset => asset.id !== "reference")!;
    expect(generated.mimeType).toBe("video/webm");
    expect(generated.storageKey).toMatch(/\.webm$/);
    expect(generated.size).toBeGreaterThan(100);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(Array.from((await storage.get(generated.storageKey))!.bytes.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const job = join(cliJobRoot, cliJobKey("personal", `${run.id}:${result.nodes[0].id}`));
    const captured = JSON.parse(await readFile(join(job, "mock-task.json"), "utf8"));
    expect(captured.request.prompt).toContain('中文 "引号"\n换行 $() `');
    expect(captured.request.assets[0].role).toBe("firstFrame");
    expect(captured.polls).toBe(2);
    expect(JSON.parse(await readFile(join(job, "manifest.json"), "utf8")).phase).toBe("archived");
    await expect(readFile(join(job, "output", "mock-result.webm"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["submitting", "needs_attention"] as const)("recovers a durable CLI manifest before its database task checkpoint from %s", async status => {
    const { service, repository } = await fixture({ model: "mock-video-v1", parameters: { resolution: "480p", duration: 2, aspectRatio: "16:9", generateAudio: false } });
    vi.mocked(service.adapters).mockRestore();
    const config = { ...CLI_DEFAULTS, version: 1 as const, siteId: "offline", siteName: "模拟网站", enabled: true, executable: process.execPath, args: [MOCK_CLI_SCRIPT_PATH] };
    await repository.saveConnection({ id: "personal", name: "Offline", provider: "cli", encryptedSecret: null, config: { cli: config } });
    const cli = service.adapters().get("cli") as CliProviderAdapter;
    const described = await cli.describe("personal");
    await repository.saveConnection({ id: "personal", name: "Offline", provider: "cli", encryptedSecret: null,
      config: { cli: config, cliStatus: { state: "ready", supportsCancel: true, configFingerprint: configFingerprint(config) }, modelCatalogModels: described.models } as unknown as JsonObject });
    const prepared = await service.prepareRun({ canvasId: "canvas", scope: "all" });
    const runId = `checkpoint-${status}`;
    const nodeId = "node-checkpoint";
    await repository.createRun({ id: runId, canvasId: "canvas", clientRequestId: runId, scope: "all", status: status === "submitting" ? "running" : "needs_attention", revisionGraph: prepared.revisionGraph });
    await repository.createNodeRun({ id: nodeId, workflowRunId: runId, nodeId: "generate", status, attempt: 1, providerTaskId: null, outputAssetIds: [], errorJson: null,
      inputJson: { provider: "cli", connectionId: "personal", cliDeadlineAt: Date.now() + 60_000 } });
    const submitted = await cli.submit({ connectionId: "personal", operation: "video.generate", model: "mock-video-v1", prompt: "fixed fixture", idempotencyKey: `${runId}:${nodeId}`, parameters: { resolution: "480p", duration: 2, aspectRatio: "16:9", generateAudio: false } });
    const submit = vi.spyOn(CliProviderAdapter.prototype, "submit");
    if (status === "submitting") await service.resumeRun(runId);
    else await service.retryRun(runId);
    const result = await terminal(service, runId);
    expect(result.run.status, JSON.stringify(result.nodes)).toBe("succeeded");
    expect(result.nodes[0].providerTaskId).toBe(submitted.providerTaskId);
    expect(result.nodes[0].attempt).toBe(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("makes a task completed during remote cancellation available for archive-only recovery", async () => {
    const { service, repository, storage } = await fixture({ model: "mock-video-v1", parameters: { resolution: "480p", duration: 2, aspectRatio: "16:9", generateAudio: false } });
    vi.mocked(service.adapters).mockRestore();
    const config = { ...CLI_DEFAULTS, version: 1 as const, siteId: "offline", siteName: "模拟网站", enabled: true, executable: process.execPath, args: [MOCK_CLI_SCRIPT_PATH, "--scenario=cancel-completed"] };
    await repository.saveConnection({ id: "personal", name: "Offline", provider: "cli", encryptedSecret: null, config: { cli: config } });
    const cli = service.adapters().get("cli") as CliProviderAdapter;
    const described = await cli.describe("personal");
    await repository.saveConnection({ id: "personal", name: "Offline", provider: "cli", encryptedSecret: null,
      config: { cli: config, cliStatus: { state: "ready", supportsCancel: true, configFingerprint: configFingerprint(config) }, modelCatalogModels: described.models } as unknown as JsonObject });
    const prepared = await service.prepareRun({ canvasId: "canvas", scope: "all" });
    const task = await cli.submit({ connectionId: "personal", operation: "video.generate", model: "mock-video-v1", prompt: "fixture", idempotencyKey: "cancel-completed:completed-node", parameters: { resolution: "480p", duration: 2, aspectRatio: "16:9", generateAudio: false } });
    await repository.createRun({ id: "cancel-completed", canvasId: "canvas", clientRequestId: "cancel-completed", scope: "all", status: "cancelled", revisionGraph: prepared.revisionGraph });
    await repository.createNodeRun({ id: "completed-node", workflowRunId: "cancel-completed", nodeId: "generate", status: "cancel_requested", attempt: 1, providerTaskId: task.providerTaskId, outputAssetIds: [], errorJson: null,
      inputJson: { provider: "cli", connectionId: "personal", providerTask: task as unknown as JsonObject } });
    await service.reconcileCancellation("cancel-completed");
    const result = await service.getRun("cancel-completed");
    expect((result?.nodes[0].inputJson.providerTask as JsonObject).status).toBe("succeeded");
    expect(result?.nodes[0].status).toBe("cancelled");
    expect(result?.nodes[0].errorJson?.message).toContain("可取回已有结果");
    await service.recoverRunOutputs("cancel-completed");
    const restored = await service.getRun("cancel-completed");
    expect(restored?.run.status).toBe("cancelled");
    expect(restored?.nodes[0].outputAssetIds).toHaveLength(1);
    const asset = await repository.getAsset(restored!.nodes[0].outputAssetIds[0]);
    expect(Array.from((await storage.get(asset!.storageKey))!.bytes.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });
});
