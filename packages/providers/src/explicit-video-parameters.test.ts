import { describe, expect, it, vi } from "vitest";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import type { ModelDescriptor, NormalizedRequest, ProviderAdapter } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import type { DocumentedModelInterface } from "./documented-interface.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";

function fixture(mode: "manual-binding" | "paid-test-binding" | "manual-rest", sparseCatalog = false) {
  // This saved custom contract intentionally differs from the native model's
  // range. Its own declared limits remain authoritative for its custom route.
  const model: ModelDescriptor = { id: "dreamina-seedance-2.0-fast", name: "Custom video", operations: ["video.generate"], outputKinds: ["video"],
    parameters: [
      { key: "duration", label: "时长", control: "number", valueType: "integer", required: true, min: 2, max: 40, step: 2,
        constraints: [{ when: [{ parameter: "resolution", values: ["720p"] }], max: 20 }] },
      { key: "resolution", label: "分辨率", control: "select", valueType: "string", required: true,
        options: [{ label: "1440p", value: "1440p" }, { label: "720p", value: "720p" }] },
    ], metadata: mode === "paid-test-binding" ? { protocolEvidence: "paid-test" } : { source: "manual" } };
  const connector: RestConnectorConfig = { auth: { type: "bearer" }, models: [model], restrictModels: true,
    submit: { path: "/v1/custom-video", method: "POST", bodyMode: "json", mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/duration", source: { kind: "request", path: "$.parameters.duration" } },
      { target: "/resolution", source: { kind: "request", path: "$.parameters.resolution" } },
    ] }, output: { kind: "video", path: "$.url" } };
  const binding: DocumentedModelInterface = { model, connector, sourceUrl: "https://api.miaowuai.store/custom-video" };
  const resolver = new StaticConnectionResolver([{ id: "isolated-explicit-video", provider: mode === "manual-rest" ? "rest" : "openai",
    apiKey: "offline-test-key", baseUrl: "https://api.miaowuai.store/v1", settings: {
      connector, scannedModelIds: [model.id], modelScanStatus: "live", modelCatalogModels: [sparseCatalog ? { ...model, parameters: [] } : model],
      autoModelInterfaces: { [model.id]: binding },
    } }]);
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ url: "https://media.example/offline-fixture.mp4" }), { headers: { "content-type": "application/json" } }));
  const fallback = { submit: vi.fn(), validate: vi.fn() } as unknown as ProviderAdapter;
  const adapter = mode === "manual-rest" ? new GenericRestAdapter(resolver, { fetch: fetcher }) : new AutoInterfaceAdapter(resolver, fallback, { fetch: fetcher });
  const request = (parameters: Record<string, unknown>): NormalizedRequest => ({ connectionId: "isolated-explicit-video", model: model.id,
    operation: "video.generate", prompt: "offline validation", idempotencyKey: "offline-only", parameters });
  return { adapter, fetcher, request, model };
}

describe.each(["manual-binding", "paid-test-binding", "manual-rest"] as const)("declared video parameter validation: %s", mode => {
  it.each([
    [{ duration: 1, resolution: "1440p" }, "parameters.duration"],
    [{ duration: 42, resolution: "1440p" }, "parameters.duration"],
    [{ duration: 3, resolution: "1440p" }, "parameters.duration"],
    [{ duration: "6", resolution: "1440p" }, "parameters.duration"],
    [{ duration: 6, resolution: "4K" }, "parameters.resolution"],
    [{ duration: 38, resolution: "720p" }, "parameters.duration"],
    [{ resolution: "1440p" }, "parameters.duration"],
  ])("blocks invalid declared parameters before any HTTP request: %j", async (parameters, path) => {
    const f = fixture(mode), input = f.request(parameters);
    expect(await f.adapter.validate(input)).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ path })]) });
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(input.parameters).toEqual(parameters);
  });

  it("preserves the explicit route and legal custom values outside the native contract", async () => {
    const f = fixture(mode), input = f.request({ duration: 38, resolution: "1440p" });
    expect(await f.adapter.validate(input)).toMatchObject({ valid: true });
    await f.adapter.submit(input);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(String(f.fetcher.mock.calls[0]?.[0])).toBe("https://api.miaowuai.store/v1/custom-video");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ model: f.model.id, duration: 38, resolution: "1440p" });
  });

  it("keeps the saved schema when a sparse directory refresh omits parameters", async () => {
    const f = fixture(mode, true), input = f.request({ duration: 42, resolution: "1440p" });
    expect(await f.adapter.validate(input)).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ path: "parameters.duration" })]) });
    await expect(f.adapter.submit(input)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.adapter.validate(f.request({ duration: 38, resolution: "1440p" }))).toMatchObject({ valid: true });
  });
});
