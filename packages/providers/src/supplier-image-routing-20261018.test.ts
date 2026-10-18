import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import type { NormalizedRequest, ProviderTask, ResolvedProviderConnection } from "./contracts.js";
import type { RestConnectorConfig } from "./rest.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const original = new Uint8Array(Buffer.from(png, "base64"));
const image = { id: "original", kind: "image" as const, mimeType: "image/png", data: original, url: "https://assets.example/original.png" };
const request: NormalizedRequest = { connectionId: "isolated", operation: "image.edit", model: "gpt-image-2.5", prompt: "Keep this original subject",
  idempotencyKey: "isolated-no-upstream", parameters: { size: "3840x2160", quality: "high", n: 1, background: "transparent", output_format: "png" }, assets: [image] };

function afeiFixture(group = "image-2稳定生图", model = request.model!) {
  const descriptor = { id: model, name: model, operations: ["image.generate", "image.edit"] as const, outputKinds: ["image"] as const };
  const chat: RestConnectorConfig["submit"] = { path: "/v1/chat/completions", method: "POST", bodyMode: "json", template: { stream: true, messages: [] },
    mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/messages", source: { kind: "openaiMessages" } }] };
  const connector: RestConnectorConfig = { auth: { type: "bearer" }, restrictModels: true, models: [descriptor],
    submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] },
    output: { path: "$.data", kind: "image", urlPath: "url", base64Path: "b64_json", defaultMimeType: "image/png" },
    modelOverrides: { [model]: { submit: chat, output: { path: "$.choices[*].message", kind: "image", format: "openai-chat-images", defaultMimeType: "image/png" } } } };
  const connection: ResolvedProviderConnection = { id: request.connectionId, provider: "rest", apiKey: "isolated-test-key", baseUrl: "https://api.3365api.cn",
    settings: { supplierKey: "cyberafei", modelGroup: group, accountKeyGroup: group, scannedModelIds: [model], modelScanStatus: "live", connector, modelCatalogModels: [descriptor] } };
  return { connection, connector };
}

describe("exact supplier image route repairs from2026-10-18 original evidence", () => {
  it.each(["base64", "url"] as const)("uses only Images edit fields and parses Afei's real HTTP200 %s shape", async output => {
    const { connection } = afeiFixture(), before = structuredClone(connection);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [output === "base64" ? { b64_json: png } : { url: "https://assets.example/result.png", b64_json: "" }] }));
    const adapter = createDefaultProviderRegistry(new StaticConnectionResolver([connection]), { fetch: fetcher }).get("rest");
    const task = await adapter.submit(request);
    expect(task.status).toBe("succeeded"); expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.3365api.cn/v1/images/edits");
    const body = fetcher.mock.calls[0]![1]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(Object.fromEntries(form.entries())).toMatchObject({ model: request.model, prompt: request.prompt, size: "3840x2160", quality: "high", n: "1", background: "transparent", output_format: "png" });
    expect(form.has("messages")).toBe(false); expect(form.has("stream")).toBe(false);
    expect(new Uint8Array(await (form.get("image") as Blob).arrayBuffer())).toEqual(original);
    const outputs = await adapter.extractOutputs(task.result);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject(output === "base64" ? { kind: "image", data: original, mimeType: "image/png" } : { kind: "image", url: "https://assets.example/result.png" });
    const persisted = JSON.parse(JSON.stringify(task)) as ProviderTask;
    const offline = vi.fn<typeof fetch>();
    const restarted = createDefaultProviderRegistry(new StaticConnectionResolver([]), { fetch: offline }).get("rest");
    expect(await restarted.extractOutputs(persisted.result)).toEqual(outputs);
    expect(offline).not.toHaveBeenCalled(); expect(connection).toEqual(before);
  });

  it.each([{ group: "image-2稳定生图", model: "gpt-image-2.5", operation: "image.generate" as const },
    { group: "图片视频模型综合分组", model: "gpt-image-2.5", operation: "image.edit" as const }])("retains Afei's separate $group/$model/$operation chat contract", async ({ group, model, operation }) => {
    const { connection } = afeiFixture(group, model);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "![image](https://assets.example/chat.png)" } }] }));
    await createDefaultProviderRegistry(new StaticConnectionResolver([connection]), { fetch: fetcher }).get("rest").submit({ ...request, model, operation, parameters: { size: "1024x1024", quality: "high" }, assets: operation === "image.edit" ? [image] : [] });
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.3365api.cn/v1/chat/completions");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ stream: true, messages: expect.any(Array) });
  });

  it("routes Secure explicit transparent edits through its existing native JSON task lifecycle", async () => {
    const connection: ResolvedProviderConnection = { id: request.connectionId, provider: "openai", apiKey: "secure-test-key", baseUrl: "https://token.secure-skill.com",
      settings: { modelGroup: "gpt", accountKeyGroup: "gpt", accountKeyGroupId: "2", scannedModelIds: ["gpt-image-2"], modelScanStatus: "live" } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: { task_id: "original-task", status: "PENDING" } }))
      .mockResolvedValueOnce(Response.json({ data: { status: "SUCCESS", result_url: "https://assets.example/secure.png" } }));
    const adapter = createDefaultProviderRegistry(new StaticConnectionResolver([connection]), { fetch: fetcher }).get("openai");
    const input = { ...request, model: "gpt-image-2" };
    expect(await adapter.validate(input)).toMatchObject({ valid: true }); expect(fetcher).not.toHaveBeenCalled();
    const task = await adapter.submit(input);
    expect(fetcher.mock.calls[0]![0]).toBe("https://token.secure-skill.com/v1/images/async/generations");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ response_format: "url", model: "gpt-image-2", prompt: input.prompt,
      size: "3840x2160", n: 1, background: "transparent", image: [image.url] });
    const done = await adapter.poll!(task);
    expect(fetcher.mock.calls[1]![0]).toBe("https://token.secure-skill.com/v1/images/async/original-task");
    expect(await adapter.extractOutputs(done.result)).toEqual([{ kind: "image", url: "https://assets.example/secure.png" }]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each([{ scannedModelIds: [] }, { modelScanStatus: "unauthorized" }, { modelCatalogModels: [{ id: "gpt-image-2", metadata: { canvasRunnable: false } }] }])("keeps Secure account gates before any paid request: %j", async extra => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createDefaultProviderRegistry(new StaticConnectionResolver([{ id: request.connectionId, provider: "openai", apiKey: "fixture", baseUrl: "https://token.secure-skill.com",
      settings: { accountKeyGroup: "gpt", accountKeyGroupId: "2", modelScanStatus: "live", scannedModelIds: ["gpt-image-2"], ...extra } }]), { fetch: fetcher }).get("openai");
    await expect(adapter.submit({ ...request, model: "gpt-image-2" })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
});
