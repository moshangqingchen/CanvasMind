import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { StaticConnectionResolver } from "./credentials.js";
import { applyJijiuImageCapabilities, JIJIU_GPT_IMAGE_IDS } from "./jijiu-image-contract.js";
import type { FetchImplementation, ModelDescriptor, NormalizedRequest, ProviderAdapter, ProviderTask, ResolvedProviderConnection } from "./contracts.js";
import type { DocumentedModelInterface } from "./documented-interface.js";
import type { RestConnectorConfig } from "./rest.js";

const id = "gpt-image-2-2K/4K", baseUrl = "https://newapi.jijiucanvas.com/v1", group = "图片-GPT-image-2-2K/4K";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKcAAAAASUVORK5CYII=";
const imageUrl = "https://assets.example/original.png";
type Mode = "auto-only" | "missing-fields" | "sparse" | "manual" | "paid-test" | "paid-source" | "connector-manual";
function fixture(provider: "openai" | "rest", mode: Mode = "auto-only", reply: "png" | "url" = "png", extra: Record<string, unknown> = {}) {
  const explicit = ["manual", "paid-test", "paid-source", "connector-manual"].includes(mode);
  const metadata = mode === "paid-test" ? { protocolEvidence: "paid-test" } : mode === "paid-source" ? { source: "paid-test" }
    : explicit ? { source: "manual" } : { source: "key-model-scan" };
  const model: ModelDescriptor = { id, name: id, operations: ["image.generate", "image.edit"], outputKinds: ["image"], metadata,
    parameters: [{ key: "size", label: "尺寸", control: "select", valueType: "string",
      options: [{ value: explicit ? "custom-size" : "auto", label: "原合同" }] },
    ...(explicit ? [{ key: "quality", label: "质量", control: "select" as const, valueType: "string" as const,
      options: [{ value: "custom-quality", label: "实测合同质量" }] }] : [])] };
  const connector: RestConnectorConfig = { auth: { type: "bearer" }, models: [model], restrictModels: true,
    submit: { path: explicit ? "/v1/explicit-images" : "/v1/obsolete-images", method: "POST", bodyMode: "json", mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      ...(explicit ? [{ target: "/chosen_size", source: { kind: "request" as const, path: "$.parameters.size" } },
        { target: "/chosen_quality", source: { kind: "request" as const, path: "$.parameters.quality" } }] : []),
    ] }, output: { path: "$.data[*]", kind: "image", base64Path: "$.b64_json", urlPath: "$.url", defaultMimeType: "image/png" } };
  const binding: DocumentedModelInterface = { model, connector, sourceUrl: `${baseUrl}/fixture-docs` };
  const current = mode === "missing-fields" ? applyJijiuImageCapabilities({ provider, config: { baseUrl, accountKeyGroup: group, modelGroup: group } }, { id, name: id, operations: ["image.generate"] })
    : explicit ? { id, name: id, operations: ["image.generate", "image.edit"] as ModelDescriptor["operations"], outputKinds: ["image"] as ModelDescriptor["outputKinds"] } : model;
  const connection: ResolvedProviderConnection = { id: "offline-jijiu", provider, apiKey: "fixture-only", baseUrl, settings: {
    accountKeyGroup: group, modelGroup: group, scannedModelIds: [id], modelScanStatus: "live", usage: "canvas",
    ...(mode === "sparse" || mode === "connector-manual" ? {} : { modelCatalogModels: [current] }),
    ...(mode === "connector-manual" ? { connector } : { autoModelInterfaces: { [id]: binding } }), ...extra } };
  const fallback = { testConnection: vi.fn(), listModels: vi.fn(), validate: vi.fn(async () => ({ valid: true, issues: [] })), submit: vi.fn(),
    poll: vi.fn(), cancel: vi.fn(), extractOutputs: vi.fn(async () => []), cleanup: vi.fn() } as unknown as ProviderAdapter;
  const fetcher = vi.fn<FetchImplementation>(async () => Response.json({ data: [reply === "png" ? { b64_json: png } : { url: imageUrl }] }));
  const resolver = new StaticConnectionResolver([connection]);
  const adapter = new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher });
  const request = (parameters: Record<string, unknown> = { size: "4K", quality: "high" }): NormalizedRequest => ({ connectionId: connection.id,
    model: id, operation: "image.generate", prompt: "offline fixture", parameters, idempotencyKey: "offline" });
  return { adapter, request, fetcher, fallback, resolver, connection, model, connector, binding };
}

describe.each(["openai", "rest"] as const)("Jijiu native images over obsolete automatic %s bindings", provider => {
  it.each(["auto-only", "missing-fields", "sparse"] as const)("replaces %s schema/template and preserves every selected 2K/4K+high field", async mode => {
    for (const size of ["2K", "4K"]) for (const operation of ["image.generate", "image.edit"] as const) {
      const f = fixture(provider, mode), original = structuredClone(f.connection);
      const request = { ...f.request({ size, quality: "high", n: 1 }), operation,
        ...(operation === "image.edit" ? { assets: [{ id: "reference", kind: "image" as const, url: imageUrl }] } : {}) };
      expect(await f.adapter.validate(request)).toEqual({ valid: true, issues: [] });
      expect(f.fetcher).not.toHaveBeenCalled();
      const task = await f.adapter.submit(request);
      expect(f.fetcher).toHaveBeenCalledOnce();
      expect(f.fetcher.mock.calls[0]![0]).toBe(`${baseUrl}/images/${operation === "image.edit" ? "edits" : "generations"}`);
      expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toEqual({ model: id, prompt: request.prompt, size, quality: "high", n: 1,
        ...(operation === "image.edit" ? { image: [imageUrl] } : {}) });
      expect(task).toMatchObject({ status: "succeeded", result: { autoInterface: true, autoInterfaceTransport: "jijiu-native-images" } });
      expect(await f.adapter.extractOutputs(task.result)).toEqual([{ kind: "image", data: new Uint8Array(Buffer.from(png, "base64")), mimeType: "image/png", filename: "openai-1.png" }]);
      expect(f.connection).toEqual(original); expect(f.fallback.submit).not.toHaveBeenCalled(); expect(f.fallback.extractOutputs).not.toHaveBeenCalled();
    }
  });
  it.each(["png", "url"] as const)("recovers persisted %s output after bindings/accounts change without HTTP or fallback", async reply => {
    const f = fixture(provider, "auto-only", reply);
    const persisted = JSON.parse(JSON.stringify(await f.adapter.submit(f.request()))) as ProviderTask;
    const fetcher = vi.fn<FetchImplementation>();
    const restarted = new AutoInterfaceAdapter(new StaticConnectionResolver([]), f.fallback, { fetch: fetcher });
    const recovered = await restarted.poll(persisted);
    expect(recovered.status).toBe("succeeded");
    expect(await restarted.extractOutputs(recovered.result)).toEqual([reply === "png"
      ? { kind: "image", data: new Uint8Array(Buffer.from(png, "base64")), mimeType: "image/png", filename: "openai-1.png" }
      : { kind: "image", url: imageUrl, mimeType: "image/png", filename: "openai-1.png" }]);
    await restarted.cancel(persisted); await restarted.cleanup(persisted.result);
    expect(fetcher).not.toHaveBeenCalled(); expect(f.fallback.poll).not.toHaveBeenCalled(); expect(f.fallback.cancel).not.toHaveBeenCalled(); expect(f.fallback.cleanup).not.toHaveBeenCalled();
  });
  it.each(["manual", "paid-test", "paid-source", "connector-manual"] as const)("preserves the actual %s schema and transport", async mode => {
    const f = fixture(provider, mode), request = f.request({ size: "custom-size", quality: "custom-quality" });
    expect((await f.adapter.validate(request)).valid).toBe(true);
    const task = await f.adapter.submit(request);
    expect(f.fetcher.mock.calls[0]![0]).toBe("https://newapi.jijiucanvas.com/v1/explicit-images");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toEqual({ model: id, prompt: request.prompt, chosen_size: "custom-size", chosen_quality: "custom-quality" });
    expect(task.result).not.toHaveProperty("autoInterfaceTransport");
    expect((await f.adapter.extractOutputs(task.result))[0]?.data).toEqual(new Uint8Array(Buffer.from(png, "base64")));
    const rejected = fixture(provider, mode);
    await expect(rejected.adapter.submit(rejected.request())).rejects.toThrow(); expect(rejected.fetcher).not.toHaveBeenCalled();
  });
  it("retains permission guards even if an old binding is saved", async () => {
    for (const extra of [{ accountKeyGroup: "图片-GPT-image-2/2.5-1K", modelGroup: "图片-GPT-image-2/2.5-1K" },
      { scannedModelIds: [] }, { usage: "agent" }, { supplierArchived: true }, { modelScanStatus: "unauthorized" },
      { modelCatalogModels: [{ id, name: id, operations: ["image.generate"], metadata: { canvasRunnable: false, canvasUnavailableReason: "403 forbidden" } }] }]) {
      const f = fixture(provider, "auto-only", "png", extra);
      expect((await f.adapter.validate(f.request())).valid).toBe(false);
      await expect(f.adapter.submit(f.request())).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.fallback.submit).not.toHaveBeenCalled();
    }
    const manual = fixture(provider, "manual", "png", { scannedModelIds: [] });
    await expect(manual.adapter.submit(manual.request({ size: "custom-size", quality: "custom-quality" }))).rejects.toThrow(); expect(manual.fetcher).not.toHaveBeenCalled();
  });
  it("keeps a manual contract with no parameter schema free-form", async () => {
    const f = fixture(provider, "manual");
    const manual = { ...f.model, parameters: undefined };
    const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ ...f.connection, settings: { ...f.connection.settings,
      autoModelInterfaces: { [id]: { ...f.binding, model: manual } } } }]), f.fallback, { fetch: f.fetcher });
    await adapter.submit(f.request({ size: "caller-defined-size", quality: "caller-defined-quality" }));
    expect(f.fetcher.mock.calls[0]![0]).toBe("https://newapi.jijiucanvas.com/v1/explicit-images");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toMatchObject({ chosen_size: "caller-defined-size", chosen_quality: "caller-defined-quality" });
  });
  it("does not let an adapter-level stale automatic connector override native images", async () => {
    const f = fixture(provider, "auto-only");
    const adapter = new AutoInterfaceAdapter(f.resolver, f.fallback, { fetch: f.fetcher, config: f.connector });
    await adapter.submit(f.request());
    expect(f.fetcher.mock.calls[0]![0]).toBe(`${baseUrl}/images/generations`);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toMatchObject({ size: "4K", quality: "high" });
  });
  it("does not borrow native routing for another source or non-exact ID", async () => {
    for (const changed of [{ baseUrl: "https://another.example/v1" }, { baseUrl: "https://newapi.jijiucanvas.com.other.example/v1" }]) {
      const f = fixture(provider, "missing-fields");
      const adapter = new AutoInterfaceAdapter(new StaticConnectionResolver([{ ...f.connection, ...changed }]), f.fallback, { fetch: f.fetcher });
      await adapter.submit(f.request());
      expect(f.fetcher.mock.calls[0]![0]).toBe(`${new URL(changed.baseUrl).origin}/v1/obsolete-images`);
    }
    const f = fixture(provider), unknown = `${id}-not-an-alias`;
    await f.adapter.submit({ ...f.request(), model: unknown }); expect(f.fallback.submit).toHaveBeenCalledOnce(); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("keeps all exact low-tier GPT routes native without giving them high-tier parameters", async () => {
    for (const low of JIJIU_GPT_IMAGE_IDS.filter(value => value !== id)) {
      const f = fixture(provider, "sparse", "png", { accountKeyGroup: "图片-GPT-image-2/2.5-1K", modelGroup: "图片-GPT-image-2/2.5-1K", scannedModelIds: [low] });
      const input = { ...f.request({ size: "1024x1024" }), model: low };
      await f.adapter.submit(input); expect(f.fetcher.mock.calls[0]![0]).toBe(`${baseUrl}/images/generations`);
      const count = f.fetcher.mock.calls.length;
      await expect(f.adapter.submit({ ...input, parameters: { size: "4K", quality: "high" } })).rejects.toThrow(); expect(f.fetcher).toHaveBeenCalledTimes(count);
    }
  });
  it("refuses malformed persisted native results without creating a replacement", async () => {
    const f = fixture(provider);
    const task = { status: "running", providerTaskId: "offline", result: { autoInterface: true, autoInterfaceTransport: "jijiu-native-images", response: { data: [] } } } as ProviderTask;
    await expect(f.adapter.poll(task)).rejects.toThrow("不能自动重发"); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.fallback.submit).not.toHaveBeenCalled();
  });
});
