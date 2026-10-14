import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const offline = vi.hoisted(() => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: offline.lookup }));
import type { FetchImplementation, ModelDescriptor, NormalizedRequest } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { getImageEditingCapabilities, imageEditingRequestIssues } from "./image-editing-capabilities.js";
import { failedTransparentImageEvidence, verifiedTransparentImageEvidence } from "./transparent-image-evidence.js";
import { RETEST_FAILED_TRANSPARENT_IMAGES, RETEST_VERIFIED_TRANSPARENT_IMAGES } from "./transparent-image-retest-evidence.js";
import { resolveImageModelContract } from "./image-model-contract.js";
import { supplierImageParameterIssues } from "./supplier-image-constraints.js";
import type { RestConnectorConfig } from "./rest.js";

const reference = { id: "reference", kind: "image" as const, role: "reference" as const, mimeType: "image/png",
  filename: "reference.png", data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), url: "https://assets.example/original.png" };
const request: NormalizedRequest = { connectionId: "one", operation: "image.edit", prompt: "reference character eats white rice",
  idempotencyKey: "offline-one-original", assets: [reference], parameters: { size: "3840x2160", background: "transparent", output_format: "png", n: 1 } };
function proof(caseId: string) { return RETEST_VERIFIED_TRANSPARENT_IMAGES.find(row => row.caseId === caseId)!; }
function scope(caseId: string) {
  const e = proof(caseId);
  return { provider: e.provider, config: { baseUrl: `https://${e.hostname}/v1`, accountKeyGroup: e.group, modelGroup: e.group,
    ...(e.supplierGroupId ? { accountKeyGroupId: e.supplierGroupId } : {}) } };
}
const model = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate"],
  parameters: [{ key: "size", label: "size", control: "dimensions", allowCustomValue: true },
    { key: "quality", label: "quality", control: "select" }], metadata: { protocol: "openai-images", supportsImageEdit: false } });

describe("original reference transparency and exact supplier identities", () => {
  beforeEach(() => { offline.fetch.mockReset().mockRejectedValue(new Error("Unexpected real HTTP")); vi.stubGlobal("fetch", offline.fetch); });
  afterEach(() => { expect(offline.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it.each(RETEST_VERIFIED_TRANSPARENT_IMAGES)("keeps $caseId confined to its original supplier/group/full ID/edit", e => {
    const source = scope(e.caseId!);
    expect(verifiedTransparentImageEvidence(source, e.model, e.selectors ?? {}, "image.edit")).toBe(e);
    expect(verifiedTransparentImageEvidence(source, e.model, e.selectors ?? {}, "image.generate")).not.toBe(e);
    for (const config of [
      { ...source.config, accountKeyGroup: "other", modelGroup: "other", ...(e.supplierGroupId ? { accountKeyGroupId: "999999" } : {}) },
      { ...source.config, baseUrl: "https://foreign.example/v1" }, { ...source.config, manualProtocol: true },
    ]) expect(verifiedTransparentImageEvidence({ ...source, config }, e.model, e.selectors ?? {}, "image.edit")).toBeUndefined();
    expect(verifiedTransparentImageEvidence(source, `${e.model}-other`, e.selectors ?? {}, "image.edit")).toBeUndefined();
    expect(e.output.fullyTransparentPixelRatio).toBeGreaterThan(0);
    expect(e.output.fullyTransparentPixelRatio).toBeLessThan(1);
    expect(e.output.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("does not give Chentu's new channel the old channel's generation proof", () => {
    const source = scope("R001");
    expect(getImageEditingCapabilities(source, "gpt-image-2.5-sunburst", proof("R001").request, "image.edit")).toMatchObject({ transparent: true,
      transparency: { status: "verified", operation: "image.edit", output: { width: 3840, height: 2160 } } });
    expect(getImageEditingCapabilities(source, "gpt-image-2.5-sunburst", {}, "image.generate").transparent).toBe(false);
    expect(verifiedTransparentImageEvidence({ ...source, config: { ...source.config, accountKeyGroup: "image2.5全参", modelGroup: "image2.5全参" } },
      "gpt-image-2.5-sunburst", {}, "image.edit")).toBeUndefined();
    expect(getImageEditingCapabilities(source, "gpt-image-2.5-sunburst", { size: "auto", size_tier: "1K", quality: "max" }, "image.edit")
      .transparency?.status).toBe("inferred");
  });

  it("preserves explicit paid/manual bindings and does not extend the Afei REST host exception", () => {
    const source = scope("H090-highest"), id = "gpt-image-2";
    for (const metadata of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }])
      expect(verifiedTransparentImageEvidence({ ...source, config: { ...source.config,
        autoModelInterfaces: { [id]: { model: { metadata } } } } }, id, {}, "image.edit")).toBeUndefined();
    const foreign = { provider: "rest", config: { baseUrl: "https://token.secure-skill.com/v1", modelGroup: "image-2-1k" } };
    expect(resolveImageModelContract(foreign, model(id)).parameters?.some(p => p.key === "quality")).toBe(true);
    const monster = { provider: "openai", config: { baseUrl: "https://api.eaheng.com/v1",
      modelGroup: "B4-GPT生图原生渠道V3（高质量）" } };
    expect(failedTransparentImageEvidence(monster, "gpt-image-2.5", { size: "3840x2160", quality: "low" })).toBeUndefined();
    expect(getImageEditingCapabilities(monster, "gpt-image-2.5", { size: "3840x2160", quality: "low" }).transparency?.status).toBe("declared");
  });

  it("keeps an opaque sample and a field rejection separate from permanent output capability", () => {
    const opaque = RETEST_FAILED_TRANSPARENT_IMAGES.find(e => e.caseId === "H034-highest")!;
    const source = { provider: opaque.provider, config: { baseUrl: `https://${opaque.hostname}/v1`, accountKeyGroupId: opaque.supplierGroupId,
      modelGroup: opaque.group, accountKeyGroup: opaque.group } };
    expect(failedTransparentImageEvidence(source, opaque.model, opaque.request, "image.edit")).toBe(opaque);
    expect(failedTransparentImageEvidence(source, opaque.model, { ...opaque.request, quality: "low" }, "image.edit")).toBeUndefined();
    expect(getImageEditingCapabilities(source, opaque.model, opaque.request, "image.edit").transparency?.note).toContain("不代表永久不支持");
    const rejected = RETEST_FAILED_TRANSPARENT_IMAGES.find(e => e.caseId === "H140")!;
    const rejectSource = { provider: rejected.provider, config: { baseUrl: `https://${rejected.hostname}/v1`, modelGroup: rejected.group,
      accountKeyGroup: rejected.group, accountKeyGroupId: rejected.supplierGroupId } };
    expect(getImageEditingCapabilities(rejectSource, rejected.model, rejected.request, "image.edit").transparency?.status).toBe("rejected");
    expect(imageEditingRequestIssues(rejectSource, { ...request, model: rejected.model, parameters: { background: "opaque" } })).toEqual([]);
  });

  it("restores pDog group4 input4K and keeps its 2161 output height explicit", () => {
    const source = scope("H035-highest"), e = proof("H035-highest");
    const projected = resolveImageModelContract(source, model(e.model));
    expect(projected.metadata?.imageSupportedResolutions).toEqual(["1K", "2K", "4K"]);
    expect(projected.parameters?.find(p => p.key === "size")?.options?.some(o => o.value === "3840x2160")).toBe(true);
    expect(getImageEditingCapabilities(source, e.model, e.request, "image.edit").transparency?.output)
      .toMatchObject({ height: 2161, requestedDimensionsMatched: false });
    expect(getImageEditingCapabilities(source, e.model, { size: "1024x1024", quality: "max" }, "image.edit").transparency?.status).toBe("inferred");
  });

  it("rebuilds only Afei's measured stable bare2.5 reference contract with highest high", () => {
    const source = scope("H049-high");
    const projected = resolveImageModelContract(source, model("gpt-image-2.5"));
    expect(projected.operations).toContain("image.edit");
    expect(projected.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "high",
      options: ["low", "medium", "high"].map(value => ({ value, label: value })) });
    expect(supplierImageParameterIssues(source, { ...request, model: "gpt-image-2.5", parameters: { quality: "max" } })[0]?.code).toBe("invalid_quality");
    const foreign = { ...source, config: { ...source.config, accountKeyGroup: "other", modelGroup: "other" } };
    expect(resolveImageModelContract(foreign, model("gpt-image-2.5")).operations).not.toContain("image.edit");
  });

  it("retains Fri codex's explicit1K restriction even though a 4K request returned alpha", () => {
    const source = scope("H079"), projected = resolveImageModelContract(source, model("gpt-image-2.5"));
    expect(projected.operations).toContain("image.edit");
    expect(projected.metadata?.imageFixedResolution).toBe("1K");
    expect(projected.parameters?.find(p => p.key === "size")?.options?.some(o => /4K/u.test(o.label))).toBe(false);
    expect(supplierImageParameterIssues(source, { ...request, model: "gpt-image-2.5", parameters: { size: "3840x2160", size_tier: "4K" } })
      .some(issue => issue.code === "invalid_group_image_size")).toBe(true);
  });

  it.each(["H119-highest", "H090-highest", "H091-highest", "H092-highest", "H049-high", "H035-highest", "H099"])(
    "sends $0 original bytes and actual highest fields through the formal adapter", async caseId => {
      const e = proof(caseId), source = scope(caseId);
      const connector: RestConnectorConfig = { auth: { type: "bearer" }, models: [model(e.model)], restrictModels: true,
        submit: { path: "/v1/images/edits/async", method: "POST", bodyMode: "multipart", template: { n: 1 },
          mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } },
            { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
            { target: "/image", source: { kind: "assets", assetKind: "image", select: "all" } }],
          response: { taskIdPath: "$.task_id", statusPath: "$.status" } },
        poll: { path: "/v1/images/tasks/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.status" } },
        statusMap: { completed: "succeeded", processing: "running" }, output: { path: "$.image_url", fallbackPaths: ["$.data"], kind: "image", urlPath: "$.url" } };
      const fetch = vi.fn<FetchImplementation>(async (_url, init) => init?.method === "GET"
        ? Response.json({ status: "completed", image_url: "https://assets.example/result.png" })
        : Response.json(e.hostname === "ai.whyshy.cn" || e.hostname === "api.mikoto.vip"
          ? { task_id: "original-task", status: "processing" } : { data: [{ url: "https://assets.example/result.png" }] },
          { status: e.hostname === "ai.whyshy.cn" || e.hostname === "api.mikoto.vip" ? 202 : 200 }));
      const supplierKey = ({ "tu.988236.xyz": "chentu", "api.mikoto.vip": "mikoto", "api.3365api.cn": "cyberafei" } as Record<string, string>)[e.hostname];
      const resolver = new StaticConnectionResolver([{ id: "one", provider: source.provider, baseUrl: String(source.config.baseUrl), apiKey: "offline-only",
        settings: { ...source.config, ...(supplierKey ? { supplierKey } : {}), connector, scannedModelIds: [e.model], modelCatalogModels: [model(e.model)] } }]);
      const adapter = createDefaultProviderRegistry(resolver, { fetch }).get(source.provider);
      const chosen = { ...request, model: e.model, parameters: e.request };
      expect((await adapter.validate(chosen)).issues).toEqual([]);
      const task = await adapter.submit(chosen);
      expect(fetch).toHaveBeenCalledOnce();
      expect(String(fetch.mock.calls[0]![0])).toBe(`https://${e.hostname}${e.transport.path}`);
      const body = fetch.mock.calls[0]![1]?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get("image")).toBeInstanceOf(Blob);
      expect([...new Uint8Array(await (body.get("image") as Blob).arrayBuffer())]).toEqual([...reference.data]);
      for (const key of ["size", "quality", "background", "output_format"]) if (e.request[key] !== undefined)
        expect(body.get(key), key).toBe(String(e.request[key]));
      if (e.hostname === "api.mikoto.vip") {
        await adapter.poll!(task);
        expect(String(fetch.mock.calls[1]![0])).toBe("https://api.mikoto.vip/v1/images/tasks/original-task");
      }
      expect(chosen.parameters).toBe(e.request);
    });
});
