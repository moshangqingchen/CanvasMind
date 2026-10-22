import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
import { StaticConnectionResolver } from "./credentials.js";
import { WeAIImageAdapter } from "./openai.js";
import { applyWeAIImageDimensionContract, WEAI_CODEX_PER_REQUEST_MODEL_GROUP as group, WEAI_CODEX_PER_REQUEST_MODELS as ids, weAIModelDescriptors } from "./weai-models.js";
import { parseWeAiLegacyGroup } from "./weai-legacy-catalog.js";
import type { FetchImplementation, NormalizedRequest } from "./contracts.js";

const payload = JSON.parse(readFileSync(new URL("./fixtures/weai-group4-20261020.json", import.meta.url), "utf8"));
const sampledAt = "2026-10-21T02:55:29.556Z";
const request: NormalizedRequest = { connectionId: "weai4", model: ids[0], operation: "image.generate", prompt: "fixture", idempotencyKey: "fixture-group4" };
function setup(groupId = "4") {
  const fetcher = vi.fn<FetchImplementation>(async (_url, init) => init?.method === "GET"
    ? Response.json({ data: [...ids, "gpt-image-1.5", "gpt-image-2-high"].map(id => ({ id })) })
    : Response.json({ data: [{ b64_json: "AAECA/8=" }] }));
  const adapter = new WeAIImageAdapter(new StaticConnectionResolver([{ id: "weai4", provider: "weai", apiKey: "fixture-key",
    baseUrl: "https://asian-acc.we-token.cc/v1", settings: { supplierKey: "weai", modelGroup: group, accountKeyGroupId: groupId, accountKeyGroup: group } }]), { fetch: fetcher });
  return { adapter, fetcher };
}
beforeEach(() => { network.fetch.mockReset().mockRejectedValue(new Error("Unexpected live HTTP")); vi.stubGlobal("fetch", network.fetch); });
afterEach(() => { try { expect(network.fetch).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); } });

describe("We-AI restored stable group 4", () => {
  it("retains the exact 3 IDs, 0.08 base × 0.7 and all 3 independent resolution quotes", () => {
    const parsed = parseWeAiLegacyGroup(payload, sampledAt, 4)!.selected!;
    expect(parsed.group).toMatchObject({ id: 4, name: group });
    expect(parsed.models.map(model => model.id)).toEqual(ids);
    for (const model of parsed.models) expect(model.pricing).toMatchObject({ kind: "per-request", currency: "USD", billingUnit: "request", unitAmount: .056,
      sourceUrl: "https://asian-acc.we-token.cc/api/v1/model-plaza-legacy/models?group_id=4", checkedAt: sampledAt,
      tiers: ["1K", "2K", "4K"].map(value => expect.objectContaining({ dimension: "resolution", value, price: .056 })) });
    expect(parseWeAiLegacyGroup(payload, sampledAt, 6)?.selected).toBeUndefined();
  });
  it("uses the actual Key model list and excludes unrelated full IDs", async () => {
    const { adapter, fetcher } = setup();
    const models = await adapter.listModels("weai4");
    expect(models.map(model => model.id).sort()).toEqual([...ids].sort());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://asian-acc.we-token.cc/v1/models");
  });
  it.each(ids)("keeps editable highest quality and all application tier presets for %s", id => {
    const model = weAIModelDescriptors(id, false, group)[0]!;
    expect(model.metadata).toMatchObject({ imageContractGroupId: "4", imageGenerationVerified: false, imageUserSizePresetSource: "user-request" });
    expect(model.name).toBe(id);
    expect(model.parameters?.find(p => p.key === "n")).toMatchObject({ max: 1 });
    expect(model.parameters?.find(p => p.key === "quality")?.default).toBe(id.includes("2.5") ? "max" : "high");
    const sizes = model.parameters?.find(p => p.key === "size")?.options ?? [];
    for (const tier of ["1K", "2K", "4K"]) expect(sizes.some(option => option.label.startsWith(tier))).toBe(true);
    expect(model.parameters?.some(p => ["background", "output_format", "response_format"].includes(p.key))).toBe(false);
    if (id.includes("2.5")) expect(model.parameters?.find(p => p.key === "size")).toMatchObject({ step: 1 });
  });
  it.each(ids)("sends %s generation as JSON with original size/quality/n", async model => {
    const { adapter, fetcher } = setup();
    const parameters = { size_tier: "4K", aspect_ratio: "16:9", size: "3840x2160", quality: model.includes("2.5") ? "max" : "high", n: 1 };
    const before = structuredClone(parameters);
    const task = await adapter.submit({ ...request, model, parameters });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://asian-acc.we-token.cc/v1/images/generations");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: "fixture", size: parameters.size, quality: parameters.quality, n: 1 });
    expect(parameters).toEqual(before);
    expect(task.status).toBe("succeeded");
  });
  it.each(ids)("sends %s edit as multipart preserving original PNG bytes and order", async model => {
    const { adapter, fetcher } = setup();
    const bytes = [new Uint8Array([137,80,78,71,13,10,26,10,0,255]), new Uint8Array([0,5,10,255])];
    await adapter.submit({ ...request, model, operation: "image.edit", parameters: { size: "3840x2160", quality: model.includes("2.5") ? "max" : "high", n: 1 },
      assets: bytes.map(data => ({ kind: "image" as const, data, mimeType: "image/png" })) });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://asian-acc.we-token.cc/v1/images/edits");
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("size")).toBe("3840x2160");
    expect(form.get("quality")).toBe(model.includes("2.5") ? "max" : "high");
    const files = form.getAll("image[]") as File[];
    expect(files).toHaveLength(2);
    for (let index = 0; index < files.length; index++) {
      expect(files[index]!.type).toBe("image/png");
      expect(new Uint8Array(await files[index]!.arrayBuffer())).toEqual(bytes[index]);
    }
  });
  it.each(["image/png", "image/jpeg", "image/webp"])("preserves a single original %s reference in the documented image field", async mimeType => {
    const { adapter, fetcher } = setup(), data = new Uint8Array([0,255,10,20]);
    await adapter.submit({ ...request, operation: "image.edit", assets: [{ kind: "image", data, mimeType }], parameters: { size: "3840x2160", quality: "high", n: 1 } });
    const form = fetcher.mock.calls[0]![1]?.body as FormData;
    expect(form.getAll("image[]")).toHaveLength(0);
    const file = form.get("image") as File;
    expect(file.type).toBe(mimeType);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(data);
  });
  it("accepts 16 references and rejects 17 before submitting", async () => {
    const { adapter, fetcher } = setup();
    const asset = { kind: "image" as const, data: new Uint8Array([0,255]), mimeType: "image/png" };
    await adapter.submit({ ...request, operation: "image.edit", assets: Array.from({ length: 16 }, () => asset), parameters: { quality: "high", n: 1 } });
    expect((fetcher.mock.calls[0]![1]?.body as FormData).getAll("image[]")).toHaveLength(16);
    fetcher.mockClear();
    await expect(adapter.submit({ ...request, operation: "image.edit", assets: Array.from({ length: 17 }, () => asset) })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(ids.slice(1))("does not copy GPT Image 2's published pixel bounds or complete quality enum to %s", async model => {
    const { adapter, fetcher } = setup();
    await adapter.submit({ ...request, model, parameters: { size: "4096x4096", quality: "custom-quality", n: 1 } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model, size: "4096x4096", quality: "custom-quality" });
  });
  it.each(["response_format", "output_format", "output_compression", "background", "style", "moderation"])("does not silently discard explicit unconfirmed %s", async key => {
    const { adapter, fetcher } = setup();
    const parameters = { size: "3840x2160", quality: "high", [key]: key === "output_compression" ? 100 : "transparent" };
    const before = structuredClone(parameters);
    await expect(adapter.submit({ ...request, parameters })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(parameters).toEqual(before);
    expect((await adapter.validate({ ...request, parameters })).issues).toContainEqual(expect.objectContaining({ path: `parameters.${key}`, code: "parameter_not_documented" }));
  });
  it.each([{ n: 2 }, { size: "3840x2168" }, { size: "4096x4096" }])("rejects invalid group 4 parameters without clamping or submitting %j", async parameters => {
    const { adapter, fetcher } = setup();
    const before = structuredClone(parameters);
    await expect(adapter.submit({ ...request, parameters })).rejects.toThrow();
    expect(parameters).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a group 6 Key binding labelled as group 4 before submitting", async () => {
    const { adapter, fetcher } = setup("6");
    const validation = await adapter.validate(request);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: "model_group_mismatch", path: "connectionId" }));
    await expect(adapter.submit(request)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not apply stable group 4 contracts to a conflicting group name or unrelated full model", () => {
    const model = { id: "gpt-image-1.5", name: "original", operations: ["image.generate" as const] };
    const connection = { provider: "weai", config: { baseUrl: "https://asian-acc.we-token.cc", accountKeyGroupId: "4", modelGroup: group } };
    expect(applyWeAIImageDimensionContract(connection, model)).toBe(model);
    expect(applyWeAIImageDimensionContract({ ...connection, config: { ...connection.config, modelGroup: "生图-openai-codex-token计费" } }, { ...model, id: ids[0] }).metadata).toBeUndefined();
  });
});
