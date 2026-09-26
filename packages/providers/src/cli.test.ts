import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelDescriptor, NormalizedRequest, ProviderTask, ResolvedProviderConnection } from "./contracts.js";
import { CLI_DEFAULTS, configFingerprint, getModelParameterDescriptor, parseCliConnectorConfig, parseCliModelCatalog, resolveModelParameters, validateModelParameters } from "./cli-contracts.js";
import { CliProviderAdapter, MOCK_CLI_SCRIPT_PATH, cliJobKey, cliProcessEnvironment, executeCliBridge } from "./cli.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const config = (scenario?: string) => parseCliConnectorConfig({
  version: 1, siteId: "mock", siteName: "独立模拟网站", accountLabel: "测试账号", executable: process.execPath,
  args: [MOCK_CLI_SCRIPT_PATH, ...(scenario ? [`--scenario=${scenario}`] : [])], enabled: true,
});

async function setup(scenario?: string) {
  const root = await mkdtemp(join(tmpdir(), "超级画布 CLI 测试 "));
  temporary.push(root);
  const cli = config(scenario);
  const connection: ResolvedProviderConnection = { id: "test-connection", provider: "cli", settings: { cli } };
  const resolver = { resolve: async () => connection };
  const adapter = new CliProviderAdapter(resolver, { jobRoot: join(root, "jobs") });
  const catalog = await adapter.describe(connection.id);
  connection.settings = { cli, cliStatus: { state: "ready", configFingerprint: configFingerprint(cli), supportsCancel: catalog.supportsCancel }, modelCatalogModels: catalog.models };
  const request: NormalizedRequest = {
    connectionId: connection.id, operation: "video.generate", model: "mock-video-v1", idempotencyKey: "run:node",
    prompt: "中文提示词 '单引号' \"双引号\"\n第二行 $(not-a-command) `also-literal`",
    parameters: { resolution: "480p", duration: 2, aspectRatio: "16:9", generateAudio: false },
  };
  return { root, cli, connection, resolver, adapter, catalog, request };
}

const model: ModelDescriptor = {
  id: "video", name: "video", operations: ["video.generate"], parameters: [
    { key: "resolution", label: "分辨率", control: "select", required: true, default: "720p", options: [{ label: "720", value: "720p" }, { label: "1080", value: "1080p" }] },
    { key: "duration", label: "秒数", control: "select", valueType: "integer", required: true, default: 5, options: [{ label: "5", value: 5 }, { label: "10", value: 10 }], constraints: [{ when: [{ parameter: "resolution", values: ["1080p"] }], options: [{ label: "5", value: 5 }] }] },
    { key: "audio", label: "声音", control: "toggle", default: false },
    { key: "voice", label: "人声", control: "text", required: true, visibleWhen: [{ parameter: "audio", values: [true] }] },
  ],
};

describe("CLI shared contracts", () => {
  it("allows placeholders and applies time defaults without inventing a model", () => {
    expect(parseCliConnectorConfig({ version: 1, siteId: "jimeng", siteName: "即梦", executable: "", enabled: false })).toEqual({ version: 1, siteId: "jimeng", siteName: "即梦", executable: "", enabled: false, args: [], ...CLI_DEFAULTS });
    expect(() => parseCliConnectorConfig({ version: 1, siteId: "a", siteName: "a", args: "--foo" })).toThrow();
    expect(() => parseCliConnectorConfig({ version: 1, siteId: "a", siteName: "a", commandTimeoutMs: -1 })).toThrow();
  });

  it("changes the readiness fingerprint when account or program configuration changes", () => {
    const original = config();
    expect(configFingerprint(original)).toBe(configFingerprint({ ...original }));
    expect(configFingerprint(original)).not.toBe(configFingerprint({ ...original, accountLabel: "另一个账号" }));
    expect(configFingerprint(original)).not.toBe(configFingerprint({ ...original, args: [...original.args, "--another"] }));
  });

  it("validates required fields, typed options and dependent durations without modifying old values", () => {
    const old = { resolution: "1080p", duration: 10, audio: true };
    const result = validateModelParameters(model, old);
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.path)).toEqual(["parameters.duration", "parameters.voice"]);
    expect(old.duration).toBe(10);
    expect(validateModelParameters(model, { resolution: "720p", duration: "5" }).valid).toBe(false);
    expect(getModelParameterDescriptor(model, "duration", old)?.options).toEqual([{ label: "5", value: 5 }]);
    expect(getModelParameterDescriptor(model, "voice", { audio: false })).toBeUndefined();
  });

  it("uses only declared defaults when explicitly switching models and preserves legal values", () => {
    const resolved = resolveModelParameters(model, { resolution: "1080p", duration: 10, audio: false, voice: "old", arbitrary: "old" });
    expect(resolved.parameters).toEqual({ resolution: "1080p", duration: 5, audio: false });
    expect(resolved.removedKeys.sort()).toEqual(["arbitrary", "duration", "voice"]);
    expect(resolved.issues).toEqual([]);
    expect(resolveModelParameters(model).parameters).toEqual({ resolution: "720p", duration: 5, audio: false });
  });

  it("rejects malformed catalogs and unsafe constraint shape", () => {
    expect(parseCliModelCatalog([model])[0]?.provider).toBe("cli");
    expect(() => parseCliModelCatalog([{ ...model, operations: ["exec"] }])).toThrow();
    expect(() => parseCliModelCatalog([{ ...model, parameters: [{ key: "foo", label: "foo", control: "text", constraints: [{ when: [], default: "surprise" }] }] }])).toThrow();
    expect(() => parseCliModelCatalog([{ ...model, parameters: [{ key: "foo", label: "foo", control: "text", visibleWhen: [{ parameter: "missing", values: [true] }] }] }])).toThrow();
    expect(() => parseCliModelCatalog([{ ...model, metadata: { inputRoles: ["execute"] } }])).toThrow();
    expect(() => parseCliModelCatalog([{ ...model, inputKinds: ["unknown"] }])).toThrow();
    expect(() => parseCliModelCatalog([{ ...model, limits: { maxInputImages: -1 } }])).toThrow();
    expect(() => parseCliModelCatalog([{ ...model, limits: { supportedMimeTypes: [true] } }])).toThrow();
  });

  it("does not pass application secrets or Node hooks to personal CLI processes", async () => {
    const result = cliProcessEnvironment({ MASTER_KEY: "secret", MASTER_KEY_FILE: "private", SUPERCANVAS_DESKTOP_TOKEN: "token", SUPER_CANVAS_INTERNAL: "private", NODE_OPTIONS: "--require=hook.js", HOME: "/home/person", USERPROFILE: "C:\\Users\\Person", APPDATA: "C:\\AppData", PATH: "commands", PERSONAL_AI_TOKEN: "personal" });
    expect(result).toEqual({ HOME: "/home/person", USERPROFILE: "C:\\Users\\Person", APPDATA: "C:\\AppData", PATH: "commands", PERSONAL_AI_TOKEN: "personal" });
  });
});

describe("CLI process and task integration", () => {
  it("only reads saved catalogs until an explicit action, including unconfigured connections", async () => {
    const connection = { id: "draft", provider: "cli", settings: { cli: { ...config(), executable: "", enabled: false }, modelCatalogModels: [] } };
    const adapter = new CliProviderAdapter({ resolve: async () => connection }, { jobRoot: join(tmpdir(), "not-created-by-list") });
    expect(await adapter.listModels("draft")).toEqual([]);
    await expect(adapter.checkConnection("draft")).rejects.toMatchObject({ code: "CLI_UNCONFIGURED" });
  });

  it("runs Unicode prompts and paths as stdin data, survives restart, and archives a playable fixed WebM", async () => {
    const { root, adapter, request, resolver } = await setup();
    expect((await adapter.checkConnection(request.connectionId)).ready).toBe(true);
    const first = await adapter.submit({ ...request, assets: [{ id: "first", kind: "image", mimeType: "image/png", role: "firstFrame", data: new Uint8Array([1, 2, 3]) }] });
    const job = join(root, "jobs", cliJobKey(request.connectionId, request.idempotencyKey));
    const saved = JSON.parse(await readFile(join(job, "mock-task.json"), "utf8"));
    expect(saved.request.prompt).toBe(request.prompt);
    expect(saved.request.assets[0].role).toBe("firstFrame");
    expect([...await readFile(saved.request.assets[0].path)]).toEqual([1, 2, 3]);
    expect(JSON.stringify(first.result)).not.toContain(process.execPath.replaceAll("\\", "\\\\"));
    const restarted = new CliProviderAdapter(resolver, { jobRoot: join(root, "jobs") });
    const recovered = await restarted.restoreTask(request.connectionId, request.idempotencyKey, first.providerTaskId);
    expect((await restarted.submit(request)).providerTaskId).toBe(first.providerTaskId);
    const running = await restarted.poll(recovered);
    expect(running.status).toBe("running");
    const done = await restarted.poll(running);
    expect(done.status).toBe("succeeded");
    const outputs = await restarted.extractOutputs(done.result);
    expect(outputs[0]?.mimeType).toBe("video/webm");
    const bytes = await readFile(outputs[0]!.localFile!.path);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
    expect(bytes.length).toBeGreaterThan(500);
    await restarted.cleanup(done.result);
    await expect(stat(join(job, "output"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await restarted.extractOutputs(done.result))[0]?.localFile).toBeDefined();
    expect((await restarted.restoreTask(request.connectionId, request.idempotencyKey)).status).toBe("succeeded");
    expect(JSON.parse(await readFile(join(job, "mock-task.json"), "utf8"))).toMatchObject({ polls: 2 });
  });

  it("validates model and linked parameter constraints before spawning or creating a task", async () => {
    const { root, adapter, request } = await setup();
    await expect(adapter.submit({ ...request, parameters: { ...request.parameters, resolution: "720p", duration: 4 } })).rejects.toThrow("秒数");
    await expect(stat(join(root, "jobs", cliJobKey(request.connectionId, request.idempotencyKey)))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await adapter.validate({ ...request, model: "invented" })).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown_model" })]));
  });

  it("rejects generation until configuration changes have been tested again", async () => {
    const { adapter, request, connection, cli } = await setup();
    connection.settings = { ...connection.settings, cli: { ...cli, accountLabel: "changed" } };
    expect((await adapter.validate(request)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "not_ready" })]));
  });

  it("reports login expiry and missing executables without exposing account details", async () => {
    const { adapter, connection, cli } = await setup();
    connection.settings = { ...connection.settings, cli: { ...cli, args: [MOCK_CLI_SCRIPT_PATH, "--scenario=login-required"] } };
    expect(await adapter.checkConnection(connection.id)).toMatchObject({ ready: false, loginRequired: true });
    connection.settings = { ...connection.settings, cli: { ...cli, executable: join(tmpdir(), "missing-cli.exe") } };
    await expect(adapter.checkConnection(connection.id)).rejects.toMatchObject({ code: "CLI_PROCESS_ERROR" });
  });

  it.each([["invalid-json", "CLI_INVALID_JSON"], ["large-output", "CLI_OUTPUT_LIMIT"], ["exit", "CLI_EXIT"]])("bounds and diagnoses %s", async (scenario, code) => {
    const cli = config(scenario);
    const promise = executeCliBridge(cli, { version: 1, action: "test", requestId: "test", context: { connectionId: "test" } });
    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow("example-private-secret");
    await expect(promise).rejects.not.toThrow("example-password");
  });

  it("terminates commands within their configured budget", async () => {
    const cli = { ...config("timeout"), commandTimeoutMs: 100 };
    const start = Date.now();
    await expect(executeCliBridge(cli, { version: 1, action: "test", requestId: "test", context: { connectionId: "test" } })).rejects.toMatchObject({ code: "CLI_TIMEOUT" });
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it("persists uncertain submissions and refuses to automatically submit again after restart", async () => {
    const { root, adapter, request, connection, resolver, cli } = await setup();
    const timeoutConfig = { ...cli, args: [...cli.args, "--scenario=submit-timeout"], submitTimeoutMs: 100 };
    connection.settings = { ...connection.settings, cli: timeoutConfig, cliStatus: { state: "ready", configFingerprint: configFingerprint(timeoutConfig), supportsCancel: true } };
    await expect(adapter.submit(request)).rejects.toMatchObject({ code: "CLI_ACTION_REQUIRED" });
    const restarted = new CliProviderAdapter(resolver, { jobRoot: join(root, "jobs") });
    await expect(restarted.submit(request)).rejects.toMatchObject({ code: "CLI_ACTION_REQUIRED" });
    await expect(restarted.restoreTask(request.connectionId, request.idempotencyKey)).rejects.toMatchObject({ code: "CLI_ACTION_REQUIRED" });
    expect(JSON.parse(await readFile(join(root, "jobs", cliJobKey(request.connectionId, request.idempotencyKey), "manifest.json"), "utf8"))).toMatchObject({ phase: "submitting" });
  });

  it("preserves a returned task id even when submission metadata is malformed", async () => {
    const { adapter, request } = await setup("submit-invalid-status");
    await expect(adapter.submit(request)).rejects.toMatchObject({ code: "CLI_ACTION_REQUIRED", providerTaskId: expect.stringMatching(/^mock-/) });
    const recovered = await adapter.restoreTask(request.connectionId, request.idempotencyKey);
    expect(recovered.status).toBe("queued");
    expect((await adapter.poll(recovered)).status).toBe("running");
    expect((await adapter.submit(request)).providerTaskId).toBe(recovered.providerTaskId);
  });

  it("allows explicit retry after confirmed login rejection, with one created task across competing retries", async () => {
    const { adapter, request, root, resolver } = await setup("login-recovery");
    const job = join(root, "jobs", cliJobKey(request.connectionId, request.idempotencyKey));
    await expect(adapter.submit(request)).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(JSON.parse(await readFile(join(job, "manifest.json"), "utf8"))).toMatchObject({ phase: "rejected" });
    await expect(stat(join(job, "mock-created-tasks.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    // Login is repaired externally; the same request key is retried only on explicit caller action.
    await writeFile(join(job, "mock-login-ready"), "logged-in");
    const otherProcessAdapter = new CliProviderAdapter(resolver, { jobRoot: join(root, "jobs") });
    const attempts = await Promise.allSettled([adapter.submit(request), otherProcessAdapter.submit(request), adapter.submit(request)]);
    const success = attempts.find((attempt): attempt is PromiseFulfilledResult<ProviderTask> => attempt.status === "fulfilled");
    expect(success).toBeDefined();
    const restored = await otherProcessAdapter.restoreTask(request.connectionId, request.idempotencyKey);
    expect(restored.providerTaskId).toBe(success!.value.providerTaskId);
    expect((await otherProcessAdapter.submit(request)).providerTaskId).toBe(restored.providerTaskId);
    expect((await readFile(join(job, "mock-submit-attempts.txt"), "utf8")).trim().split("\n")).toHaveLength(2);
    expect((await readFile(join(job, "mock-created-tasks.txt"), "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("rejects imported or forged task snapshots without executing CLI", async () => {
    const { adapter, request } = await setup();
    const forged: ProviderTask = { providerTaskId: "remote", status: "running", result: { cli: { connectionId: request.connectionId, jobKey: "../outside" }, remote: { status: "running" } } };
    await expect(adapter.poll(forged)).rejects.toMatchObject({ code: "CLI_ACTION_REQUIRED" });
    await expect(adapter.poll({ providerTaskId: "remote", status: "running" })).rejects.toMatchObject({ code: "CLI_ACTION_REQUIRED" });
  });

  it("refuses paths outside the task output directory", async () => {
    const { adapter, request } = await setup("path-escape");
    const task = await adapter.submit(request);
    await adapter.poll(task);
    const completed = await adapter.poll(task);
    await expect(adapter.extractOutputs(completed.result)).rejects.toThrow("超出本任务输出目录");
  });

  it("does not trust output data supplied in a task snapshot", async () => {
    const { adapter, request } = await setup();
    const task = await adapter.submit(request);
    const forged = { ...(task.result as object), remote: { outputs: [{ kind: "video", path: "C:/private.mp4" }] } };
    expect(await adapter.extractOutputs(forged)).toEqual([]);
  });

  it("cancels supported tasks and only stops tracking unsupported tasks", async () => {
    const normal = await setup();
    const task = await normal.adapter.submit(normal.request);
    await normal.adapter.cancel(task);
    expect((await normal.adapter.poll(task)).status).toBe("cancelled");
    const unsupported = await setup("no-cancel");
    const unsupportedTask = await unsupported.adapter.submit(unsupported.request);
    await unsupported.adapter.cancel(unsupportedTask);
    const job = join(unsupported.root, "jobs", cliJobKey(unsupported.request.connectionId, unsupported.request.idempotencyKey));
    expect(JSON.parse(await readFile(join(job, "manifest.json"), "utf8"))).toMatchObject({ trackingStopped: true, remote: { status: "queued" } });
    expect(JSON.parse(await readFile(join(job, "mock-task.json"), "utf8"))).toMatchObject({ cancelled: false });
  });

  it("supports the same local output interface for image generation", async () => {
    const { adapter, request } = await setup();
    const task = await adapter.submit({ ...request, operation: "image.generate", model: "mock-image-v1", parameters: { quality: "standard" } });
    await adapter.poll(task);
    const done = await adapter.poll(task);
    expect(await adapter.extractOutputs(done.result)).toEqual([expect.objectContaining({ kind: "image", mimeType: "image/png", localFile: expect.any(Object) })]);
  });

  it.each([["cancel-pending", "running"], ["cancel-wrong-task", "queued"], ["cancel-completed", "succeeded"]])("does not claim remote cancellation for %s", async (scenario, status) => {
    const { adapter, request } = await setup(scenario);
    const task = await adapter.submit(request);
    await expect(adapter.cancel(task)).rejects.toMatchObject({ code: "CLI_ACTION_REQUIRED" });
    const recovered = await adapter.restoreTask(request.connectionId, request.idempotencyKey);
    expect(recovered.status).toBe(status);
    if (status === "succeeded") expect(await adapter.extractOutputs(recovered.result)).toEqual([expect.objectContaining({ kind: "video" })]);
  });
});
