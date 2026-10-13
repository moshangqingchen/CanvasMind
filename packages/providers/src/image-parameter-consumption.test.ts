import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
import type { FetchImplementation, ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { WeAIImageAdapter } from "./openai.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";

const unexpectedFetch = vi.fn<typeof fetch>();
beforeEach(() => {
  unexpectedFetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP in image contract consumption test"));
  vi.stubGlobal("fetch", unexpectedFetch);
});
afterEach(() => {
  try { expect(unexpectedFetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

function descriptor(size = "3520x2336"): ModelDescriptor {
  return {
    id: "gpt-image-2.5-flare", name: "offline image contract", operations: ["image.generate", "image.edit"],
    parameters: [
      { key: "size", label: "尺寸", control: "dimensions", valueType: "string", default: "auto", allowCustomValue: true,
        options: [{ label: "自动", value: "auto" }, { label: `4K · 3:2 · ${size}`, value: size }] },
      { key: "quality", label: "质量", control: "select", default: "max", options: [{ label: "最高", value: "max" }] },
      { key: "output_format", label: "格式", control: "select", default: "png", options: [{ label: "PNG", value: "png" }] },
    ],
  };
}
function request(parameters: Record<string, unknown> = { size: "auto", size_tier: "4K", aspect_ratio: "3:2" }): NormalizedRequest {
  return { connectionId: "contract-consumer", model: descriptor().id, operation: "image.generate", prompt: "offline fixture",
    idempotencyKey: "offline-contract-consumer", parameters };
}
function connector(model?: ModelDescriptor): RestConnectorConfig {
  return {
    auth: { type: "none" }, allowedHosts: ["provider.test"], ...(model ? { models: [model] } : {}),
    submit: { path: "/generate", method: "POST", bodyMode: "json",
      mappings: ["size", "quality", "output_format"].map(key => ({ target: `/${key}`,
        source: { kind: "request" as const, path: `$.parameters.${key}` }, omitIfUndefined: true })),
      response: { taskIdPath: "$.id" } },
    poll: { path: "/task/{taskId}", method: "GET", bodyMode: "none" },
    output: { path: "$.outputs", kind: "image", urlPath: "$.url" },
  };
}
function restFixture(options: { manual?: boolean; fixed?: boolean; connectorModel?: ModelDescriptor; catalogModel?: ModelDescriptor } = {}) {
  const config = connector(options.connectorModel);
  const fetcher = vi.fn<FetchImplementation>(async () => Response.json({ id: "existing-task" }));
  const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "contract-consumer", provider: "rest", baseUrl: "https://provider.test",
    settings: { connector: config, ...(options.catalogModel ? { modelCatalogModels: [options.catalogModel] } : {}),
      ...(options.manual ? { manualProtocol: true } : {}) } }]), { fetch: fetcher, ...(options.fixed ? { config } : {}) });
  return { adapter, fetcher, body: () => JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown> };
}

describe("shared image rules at adapter request boundaries", () => {
  it("resolves the WeAI catalog choice without sending menu defaults or mutating the saved selection", async () => {
    const fetcher = vi.fn<FetchImplementation>(async () => Response.json({ data: [{ b64_json: "AQID" }] }));
    const adapter = new WeAIImageAdapter(new StaticConnectionResolver([{ id: "contract-consumer", provider: "weai", apiKey: "fixture",
      baseUrl: "https://asian-acc.we-token.cc/v1", settings: { modelGroup: "生图-openai-adobe-image2.5专属", modelCatalogModels: [descriptor()] } }]), { fetch: fetcher });
    const input = request(), original = structuredClone(input);
    expect(await adapter.validate(input)).toMatchObject({ valid: true });
    expect(fetcher).not.toHaveBeenCalled();
    await adapter.submit(input);
    expect(fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ size: "3520x2336" });
    for (const key of ["quality", "output_format", "size_tier", "aspect_ratio"]) expect(body).not.toHaveProperty(key);
    expect(input).toEqual(original);
  });

  it("keeps REST connector-before-catalog precedence and leaves omitted defaults off the wire", async () => {
    const f = restFixture({ connectorModel: descriptor(), catalogModel: descriptor("3072x2048") });
    const input = request(), original = structuredClone(input);
    expect(await f.adapter.validate(input)).toMatchObject({ valid: true });
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.adapter.submit(input);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.body()).toEqual({ size: "3520x2336" });
    expect(input).toEqual(original);
  });

  it("falls back to the REST saved catalog when the connector has no model descriptor", async () => {
    const f = restFixture({ catalogModel: descriptor("3072x2048") });
    await f.adapter.submit(request());
    expect(f.body()).toEqual({ size: "3072x2048" });
  });

  it("preserves explicit REST pixels and quality instead of replacing them with rule defaults", async () => {
    const f = restFixture({ connectorModel: descriptor() });
    const input = request({ size: "2000x1200", size_tier: "4K", quality: "high" }), original = structuredClone(input);
    await f.adapter.submit(input);
    expect(f.body()).toEqual({ size: "2000x1200", quality: "high" });
    expect(input).toEqual(original);
  });

  it.each(["manual", "fixed", "missing-descriptor"] as const)("retains REST %s transport parameter ownership", async mode => {
    const f = restFixture(mode === "missing-descriptor" ? {} : { connectorModel: descriptor(), [mode]: true });
    await f.adapter.submit(request());
    expect(f.body()).toEqual({ size: "auto" });
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
});
