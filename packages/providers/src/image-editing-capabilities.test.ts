import { describe, expect, it, vi } from "vitest";
import type { FetchImplementation, NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { getImageEditingCapabilities, imageEditingRequestIssues } from "./image-editing-capabilities.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { cangyuanCurrentTransport } from "./cangyuan-current-models.js";
import { PdogImageAdapter } from "./pdog-image.js";

const connection = (host: string, group = "default", provider = "openai") => ({ provider, config: { baseUrl: `https://${host}/v1`, modelGroup: group } });
const request: NormalizedRequest = { connectionId: "one", model: "gpt-image-2", operation: "image.generate", prompt: "offline contract", idempotencyKey: "offline-one" };
const original: ProviderAssetInput = { id: "original", kind: "image", role: "reference", mimeType: "image/png", data: new Uint8Array([1, 2, 3]), url: "https://assets.example/original.png" };
const mask: ProviderAssetInput = { id: "mask", kind: "image", role: "mask", mimeType: "image/png", data: new Uint8Array([4, 5, 6]), url: "https://assets.example/mask.png" };
const edit: NormalizedRequest = { ...request, operation: "image.edit", assets: [original, mask] };
function fixture(host: string, group = "default", provider = "openai", settings: Record<string, unknown> = {}) {
  const source = connection(host, group, provider);
  const fetch = vi.fn<FetchImplementation>(async () => Response.json(host === "token.secure-skill.com"
    ? { data: { task_id: "accepted", status: "PENDING" } } : { data: [{ url: "https://assets.example/result.png" }] }));
  const resolver = new StaticConnectionResolver([{ id: "one", provider, baseUrl: source.config.baseUrl, apiKey: "offline-fixture", settings: { ...source.config, ...settings } }]);
  return { source, fetch, resolver, adapter: createDefaultProviderRegistry(resolver, { fetch }).get(provider) };
}

describe("exact image editing capabilities", () => {
  it("limits transparency to exact declared suppliers, groups and models", () => {
    const rows = [
      ["token.secure-skill.com", "default", "gpt-image-2", true],
      ["token.secure-skill.com", "default", "gpt-image-2.5-flare", false],
      ["tu.988236.xyz", "image2.5全参", "gpt-image-2.5-flare", true],
      ["tu.988236.xyz", "default", "gpt-image-2.5-flare", false],
      ["api.eaheng.com", "B4-GPT生图原生渠道V3（高质量）", "gpt-image-2.5-sunburst-max", true],
      ["api.eaheng.com", "B1-GPT生图原生渠道V1", "gpt-image-2", false],
      ["genimage.pro", "gptResponseBase64", "gpt-image-2.5-sunburst", true],
      ["genimage.pro", "default", "gpt-image-2", false],
      ["api.frimodel.com", "default", "gpt-image-2", false],
      ["api.tk1688.com", "default", "gpt-image-1", false],
      ["token.secure-skill.com.example", "default", "gpt-image-2", false],
    ] as const;
    for (const [host, group, model, transparent] of rows)
      expect(getImageEditingCapabilities(connection(host, group), model).transparent, `${host}/${group}/${model}`).toBe(transparent);
    for (const baseUrl of ["http://token.secure-skill.com", "https://token.secure-skill.com/custom", "https://user@token.secure-skill.com", "https://token.secure-skill.com:8443"])
      expect(getImageEditingCapabilities({ provider: "openai", config: { baseUrl } }, "gpt-image-2").transparent).toBe(false);
  });

  it("does not infer mask support from model-family resemblance", () => {
    const cangyuan = connection("ai.cangyuansuanli.cn", "default", "rest");
    for (const model of ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])
      expect(getImageEditingCapabilities(cangyuan, model).mask).toBe("url");
    for (const tier of ["1k", "2k", "4k"]) expect(getImageEditingCapabilities(cangyuan, "gpt-image-2-x", { tier }).mask).toBe("url");
    for (const model of ["gpt-image-2", "gpt-image-2.5-flare-4k", "gpt-image-2.5-x"])
      expect(getImageEditingCapabilities(cangyuan, model, { tier: "4k" }).mask).toBe(null);
    expect(getImageEditingCapabilities(cangyuan, "gpt-image-2-x", { tier: "web" }).mask).toBe(null);
    expect(getImageEditingCapabilities(connection("api.tk1688.com"), "gpt-image-1").mask).toBe("multipart");
    expect(getImageEditingCapabilities(connection("api.tk1688.com"), "gpt-image-1@s1c2").mask).toBe(null);
    expect(getImageEditingCapabilities(connection("api.frimodel.com"), "gpt-image-2-high").mask).toBe(null);
    for (const family of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])
      for (const tier of ["1k", "2k", "4k"])
        expect(getImageEditingCapabilities(connection("vapi.chuangxiangai.asia", "生图"), `${family}-${tier}`).mask).toBe("url");
  });

  it("requires one PNG mask and an original on image.edit", () => {
    const source = connection("api.frimodel.com");
    expect(imageEditingRequestIssues(source, edit)).toEqual([]);
    expect(imageEditingRequestIssues(source, { ...edit, assets: [mask] })).toContainEqual(expect.objectContaining({ code: "mask_requires_image" }));
    expect(imageEditingRequestIssues(source, { ...edit, assets: [original, mask, mask] })).toContainEqual(expect.objectContaining({ code: "multiple_masks" }));
    expect(imageEditingRequestIssues(source, { ...edit, operation: "image.generate" })).toContainEqual(expect.objectContaining({ code: "mask_requires_edit" }));
    expect(imageEditingRequestIssues(source, { ...edit, assets: [original, { ...mask, mimeType: "image/jpeg" }] })).toContainEqual(expect.objectContaining({ code: "invalid_mask" }));
  });
});

describe("actual transparent and mask transport", () => {
  it.each([
    ["token.secure-skill.com", "default", "gpt-image-2"],
    ["tu.988236.xyz", "image2.5全参", "gpt-image-2.5-flare"],
    ["api.eaheng.com", "B4-GPT生图原生渠道V3（高质量）", "gpt-image-2"],
    ["genimage.pro", "default", "gpt-image-2.5-sunburst"],
  ])("transmits transparent background on %s %s %s", async (host, group, model) => {
    const f = fixture(host, group);
    await f.adapter.submit({ ...request, model, parameters: { background: "transparent" } });
    expect(f.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String(f.fetch.mock.calls[0]![1]?.body));
    expect(body.background).toBe("transparent");
    // Secure Skill documents intrinsic RGBA PNG, not an output_format field.
    if (host !== "token.secure-skill.com") expect(body.output_format).toBe("png");
    f.fetch.mockClear();
    await f.adapter.submit({ ...request, model, parameters: { background: "opaque" } });
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body)).background).toBe("opaque");
    f.fetch.mockClear();
    await expect(f.adapter.submit({ ...request, model, parameters: { background: "transparent", output_format: "jpeg" } })).rejects.toThrow(/PNG/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(["api.frimodel.com", "api.tk1688.com"])("sends multipart mask independently on %s", async host => {
    const f = fixture(host, "default", "openai", host === "api.frimodel.com" ? { supplierKey: "frimodel" } : {});
    await f.adapter.submit({ ...edit, model: host === "api.frimodel.com" ? "gpt-image-2" : "gpt-image-1" });
    expect(f.fetch).toHaveBeenCalledOnce();
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://${host}/v1/images/edits`);
    const body = init?.body as FormData;
    expect(body.getAll("image")).toHaveLength(1);
    expect(body.has("image[]")).toBe(false);
    expect(body.getAll("mask")).toHaveLength(1);
    expect(Array.from(new Uint8Array(await (body.get("image") as Blob).arrayBuffer()))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(await (body.get("mask") as Blob).arrayBuffer()))).toEqual([4, 5, 6]);
  });

  it("sends Chuangxiang HTTPS mask outside the nine-reference budget", async () => {
    const f = fixture("vapi.chuangxiangai.asia", "生图");
    const originals = Array.from({ length: 9 }, (_, i) => ({ ...original, id: `ref${i}`, url: `https://assets.example/${i}.png` }));
    await f.adapter.submit({ ...edit, model: "gpt-image-2.5-flare-4k", assets: [...originals, mask] });
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://vapi.chuangxiangai.asia/v1/images/edits");
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ images: originals.map(a => a.url), mask: mask.url });
  });

  it.each(["gpt-image-2-x", "gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("sends the documented Cangyuan %s mask and polls the edit task", async model => {
    const transport = cangyuanCurrentTransport(model);
    const connector: RestConnectorConfig = transport ? { submit: transport.submit!, poll: transport.poll, output: transport.output! } : {
      submit: { path: "/v1/images/generations", method: "POST", bodyMode: "json", mappings: [
        { target: "/model", source: { kind: "request", path: "$.model" } },
        { target: "/images", source: { kind: "assets", assetKind: "image", select: "all" } },
      ], response: { taskIdPath: "$.id", statusPath: "$.status" } },
      poll: { path: "/v1/images/generations/{taskId}", method: "GET", bodyMode: "none" },
      output: { path: "$.data", kind: "image", urlPath: "$.url" },
    };
    const f = fixture("ai.cangyuansuanli.cn", "default", "rest", { connector });
    f.fetch.mockImplementation(async () => Response.json({ id: "accepted", status: "running" }));
    const adapter = new GenericRestAdapter(f.resolver, { fetch: f.fetch });
    const task = await adapter.submit({ ...edit, model, parameters: { tier: "4k" } });
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://ai.cangyuansuanli.cn/v1/images/edits");
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ images: [original.url], mask: mask.url });
    await adapter.poll(task);
    expect(String(f.fetch.mock.calls[1]![0])).toBe("https://ai.cangyuansuanli.cn/v1/images/edits/accepted");
  });

  it.each(["token.secure-skill.com", "api.frimodel.com", "vapi.chuangxiangai.asia", "other.example"])("rejects unsupported transparent/mask requests without sending on %s", async host => {
    const f = fixture(host, "生图");
    await expect(f.adapter.submit({ ...request, model: "gpt-image-2.5-flare", parameters: { background: "transparent" } })).rejects.toThrow(/透明/u);
    await expect(f.adapter.submit({ ...edit, model: "gpt-image-2.5-flare-high" })).rejects.toThrow(/蒙版/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("does not discard unsupported transparency in the direct PDog normalizer", async () => {
    const f = fixture("ai.whyshy.cn", "default");
    const adapter = new PdogImageAdapter(f.resolver, { fetch: f.fetch });
    await expect(adapter.submit({ ...request, parameters: { background: "transparent" } })).rejects.toThrow(/透明/u);
    await expect(adapter.submit(edit)).rejects.toThrow(/蒙版/u);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("retains exact model permission gates when replacing a saved mapping that would lose background", async () => {
    const model = "gpt-image-2";
    const connector = { submit: { path: "/wrong", method: "POST", bodyMode: "json", template: { model } }, output: { path: "$.data", kind: "image", urlPath: "$.url" } };
    const binding = { autoModelInterfaces: { [model]: { model: { id: model, name: model, operations: ["image.generate"] }, connector } } };
    const f = fixture("api.eaheng.com", "B4-GPT生图原生渠道V3（高质量）", "openai", binding);
    await f.adapter.submit({ ...request, parameters: { background: "transparent" } });
    expect(String(f.fetch.mock.calls[0]![0])).toBe("https://api.eaheng.com/v1/images/generations");
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]?.body))).toMatchObject({ background: "transparent", output_format: "png" });
    for (const settings of [{ scannedModelIds: ["unrelated"] }, { modelCatalogModels: [{ id: model, metadata: { canvasRunnable: false } }] }]) {
      const denied = fixture("api.eaheng.com", "B4-GPT生图原生渠道V3（高质量）", "openai", { ...binding, ...settings });
      await expect(denied.adapter.submit({ ...request, parameters: { background: "transparent" } })).rejects.toThrow(/权限/u);
      expect(denied.fetch).not.toHaveBeenCalled();
    }
  });

  it("rejects incompatible saved mask transports and unsafe mask links instead of dropping them", async () => {
    const connector: RestConnectorConfig = { submit: { path: "/v1/images/edits", method: "POST", bodyMode: "multipart" }, output: { path: "$.data", kind: "image", urlPath: "$.url" } };
    const f = fixture("ai.cangyuansuanli.cn", "default", "rest", { connector });
    await expect(f.adapter.submit({ ...edit, model: "gpt-image-2-4k" })).rejects.toThrow(/传输方式/u);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(imageEditingRequestIssues(connection("vapi.chuangxiangai.asia", "生图"), {
      ...edit, model: "gpt-image-2-4k", assets: [original, { ...mask, url: "https://user@assets.example/mask.png" }],
    })).toContainEqual(expect.objectContaining({ code: "invalid_mask_url" }));
  });
});
