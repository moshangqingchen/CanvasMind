import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { isSecureSkillImageConnection } from "./secure-skill-image.js";
import type { NormalizedRequest, ProviderTask } from "./contracts.js";
import { applySecureSkillImageCapabilities, SECURE_SKILL_IMAGE_PIXELS, secureSkillImageParameterIssues } from "./secure-skill-image-contract.js";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pending = () => response({ code: "success", data: { task_id: "img-test", status: "PENDING" } });
const makeAdapter = (fetcher: typeof fetch, baseUrl = "https://token.secure-skill.com/v1", settings: Readonly<Record<string, unknown>> = {}) =>
  createDefaultProviderRegistry(new StaticConnectionResolver([{
    id: "secure", provider: "openai", baseUrl, apiKey: "test-key",
    settings: { defaultModel: "gpt-image-2.5-flare", supplierKey: "custom-supplier-id", ...settings },
  }]), { fetch: fetcher }).get("openai");
const request: NormalizedRequest = {
  connectionId: "secure", model: "gpt-image-2.5-flare", operation: "image.edit", prompt: "Keep the reference subject",
  idempotencyKey: "paid-once", parameters: { size: "1024x1024", quality: "max" },
  assets: [{ id: "reference", kind: "image", mimeType: "image/png", url: "https://assets.example.com/reference.png", data: new Uint8Array([1, 2, 3]) }],
};

describe("Secure Skill GPT Images protocol", () => {
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"])("submits %s references as ordered JSON URLs and persists the native task", async model => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending());
    const quality = model === "gpt-image-2" ? "high" : "max";
    const task = await makeAdapter(fetcher).submit({ ...request, model,
      parameters: { ...request.parameters, quality },
      assets: [...request.assets!, { id: "second", kind: "image", mimeType: "image/jpeg", url: "https://assets.example.com/second.jpg" }] });
    expect(task).toMatchObject({ providerTaskId: "img-test", status: "queued", result: { secureSkillImage: true, connectionId: "secure" } });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://token.secure-skill.com/v1/images/async/generations");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: request.prompt, ...(model === "gpt-image-2" ? { size: "1024x1024" } : { resolution: "1K", aspect_ratio: "1:1", quality }), response_format: "url",
      image: ["https://assets.example.com/reference.png", "https://assets.example.com/second.jpg"], ...(model === "gpt-image-2" ? { background: "opaque" } : {}) });
  });

  it("omits references for generation and omits auto sentinels", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending());
    await makeAdapter(fetcher, "https://token.secure-skill.com").submit({ ...request, model: undefined, operation: "image.generate", assets: [], parameters: { size: "auto", quality: "auto" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ model: "gpt-image-2.5-flare", prompt: request.prompt, response_format: "url" });
  });

  it("preserves the measured PNG parameter on native gpt-image-2 transparent generation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending());
    const task = await makeAdapter(fetcher, "https://token.secure-skill.com", {
      defaultModel: "gpt-image-2", modelGroup: "image-2-1k", accountKeyGroup: "image-2-1k",
    }).submit({ ...request, model: "gpt-image-2", operation: "image.generate", assets: [],
      parameters: { size: "1024x1024", quality: "high", n: 1, background: "transparent", output_format: "png" } });
    expect(task).toMatchObject({ providerTaskId: "img-test", status: "queued", result: { secureSkillImage: true } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe("https://token.secure-skill.com/v1/images/async/generations");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ response_format: "url", model: "gpt-image-2",
      prompt: request.prompt, size: "1024x1024", background: "transparent", n: 1, output_format: "png" });
  });

  it.each(["image.generate", "image.edit"] as const)("keeps PNG transmission scoped away from ordinary or reference %s requests", async operation => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending());
    const background = operation === "image.edit" ? "transparent" : "opaque";
    await makeAdapter(fetcher).submit({ ...request, model: "gpt-image-2", operation,
      assets: operation === "image.edit" ? request.assets : [],
      parameters: { size: "1024x1024", quality: "high", n: 1, background, output_format: "png" } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe("https://token.secure-skill.com/v1/images/async/generations");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ response_format: "url", model: "gpt-image-2",
      prompt: request.prompt, size: "1024x1024", background, n: 1,
      ...(operation === "image.edit" ? { image: ["https://assets.example.com/reference.png"] } : {}) });
  });

  it.each([
    { result_url: "https://cdn.example.com/result.png" },
    { data: { data: [{ url: "https://cdn.example.com/result.png", b64_json: "" }] } },
  ])("resumes polling after adapter restart and extracts the completed image", async output => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(response({ data: { task_id: "img-test", status: "RUNNING" } }))
      .mockResolvedValueOnce(response({ data: { task_id: "img-test", status: "SUCCESS", ...output } }));
    const task = JSON.parse(JSON.stringify(await makeAdapter(fetcher).submit(request))) as ProviderTask;
    const restarted = makeAdapter(fetcher);
    const running = await restarted.poll!(task);
    expect(running.status).toBe("running");
    const completed = await restarted.poll!(running);
    expect(completed.status).toBe("succeeded");
    expect(await restarted.extractOutputs(completed.result)).toEqual([{ kind: "image", url: "https://cdn.example.com/result.png" }]);
    expect(fetcher.mock.calls.slice(1).map(([url, init]) => [url, init?.method])).toEqual([
      ["https://token.secure-skill.com/v1/images/async/img-test", "GET"],
      ["https://token.secure-skill.com/v1/images/async/img-test", "GET"],
    ]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("reports an explicit asynchronous failure without submitting again", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending()).mockResolvedValueOnce(response({ code: "failed", data: {
      task_id: "img-test", status: "FAILED", error: { code: "no_image_output", message: "upstream did not return image output" },
    } }));
    const adapter = makeAdapter(fetcher);
    expect(await adapter.poll!(await adapter.submit(request))).toMatchObject({ status: "failed", error: "upstream did not return image output" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects local references before any generation when no sharing channel was chosen", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(makeAdapter(fetcher).submit({ ...request, assets: [{ ...request.assets![0]!, url: undefined }] })).rejects.toThrow("当前生成尚未提交");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retains ambiguity after a missing task id or HTTP 502 and never falls back to another paid endpoint", async () => {
    for (const result of [response({ code: "success", data: {} }), response({ code: "success", data: { task_id: "" } }), response({ error: { code: "upstream_error", message: "Upstream request failed" } }, 502)]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(result);
      await expect(makeAdapter(fetcher).submit(request)).rejects.toMatchObject({ details: { phase: "submit", submissionMayHaveOccurred: true, retryable: false } });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it("preserves multipart edits for other suppliers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ data: [{ url: "https://other.example.com/result.png" }] }));
    await makeAdapter(fetcher, "https://other.example.com/v1").submit(request);
    expect(fetcher.mock.calls[0]![0]).toBe("https://other.example.com/v1/images/edits");
    expect(fetcher.mock.calls[0]![1]?.body).toBeInstanceOf(FormData);
    expect(isSecureSkillImageConnection({ baseUrl: "https://token.secure-skill.com.evil.test/v1" }, request.model)).toBe(false);
    expect(isSecureSkillImageConnection({ baseUrl: "https://token.secure-skill.com/v1" }, "nano-banana-2")).toBe(false);
  });

  it("sends the current Image 2.5 native 4K and new ratios while preserving unrepresentable saved pixels", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = makeAdapter(fetcher, "https://token.secure-skill.com", { modelGroup: "gpt-image-2.5" });
    const parameters = { size: "3840x2160", quality: "max" };
    await expect(adapter.submit({ ...request, parameters })).rejects.toThrow("不接受自定义宽高");
    expect(parameters).toEqual({ size: "3840x2160", quality: "max" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await adapter.validate({ ...request, parameters: { size: "1536x1024", quality: "max" } })).toMatchObject({ valid: true });
    fetcher.mockResolvedValueOnce(pending());
    await adapter.submit({ ...request, parameters: { resolution: "4K", aspect_ratio: "3:1", quality: "max" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ resolution: "4K", aspect_ratio: "3:1", quality: "max" });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).not.toHaveProperty("image_size");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).not.toHaveProperty("size");
  });
  it.each(["512x512", "256x3840", "3840x256", "3840x3840", "1920x1088"])("sends official GPT2 custom %s without borrowed area or ratio caps", async size => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending()), adapter = makeAdapter(fetcher);
    const input = { ...request, model: "gpt-image-2", operation: "image.generate" as const, assets: [], parameters: { size, quality: "high" } };
    expect(await adapter.validate(input)).toMatchObject({ valid: true });
    await adapter.submit(input);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ size });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).not.toHaveProperty("quality");
  });
  it.each(["1920x1080", "240x240", "3856x1024"])("keeps the actual Secure GPT2 edge/alignment restriction for %s", async size => {
    const fetcher = vi.fn<typeof fetch>(), adapter = makeAdapter(fetcher);
    await expect(adapter.submit({ ...request, model: "gpt-image-2", parameters: { size } })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("passes image_size and aspect_ratio as the supplier's native JSON fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending());
    await makeAdapter(fetcher).submit({ ...request, model: "gpt-image-2", parameters: { image_size: "2K", aspect_ratio: "5:4", quality: "high" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ image_size: "2K", aspect_ratio: "5:4" });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).not.toHaveProperty("size");
  });
  it("labels auto as independent native fields and preserves saved 2K 16:9 JSON input", async () => {
    const config = { baseUrl: "https://token.secure-skill.com", modelGroup: "image-2-1k", accountKeyGroup: "image-2-1k" };
    const model = applySecureSkillImageCapabilities({ provider: "openai", config }, {
      id: "gpt-image-2", name: "GPT2", operations: ["image.generate"], parameters: [],
    });
    const size = model.parameters?.find(row => row.key === "size");
    expect(size?.default).toBe("auto");
    expect(size?.options?.find(row => row.value === "auto")?.label).toBe("按独立档位与比例（未指定时供应商默认）");
    expect(size?.options?.find(row => row.value === "auto")?.label).not.toContain("1:1");
    expect(size?.description).toContain("两字段均未指定时供应商默认 2K·1:1");
    const parameters = { size: "auto", image_size: "2K", aspect_ratio: "16:9", n: 1 };
    const original = structuredClone(parameters), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending());
    await makeAdapter(fetcher, config.baseUrl, config).submit({ ...request, model: "gpt-image-2", operation: "image.generate", assets: [], parameters });
    expect(parameters).toEqual(original);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ response_format: "url", model: "gpt-image-2",
      prompt: request.prompt, image_size: "2K", aspect_ratio: "16:9", n: 1, background: "opaque" });
  });
  it("retains only the complete official matrix and does not expand manual contracts", () => {
    const config = { baseUrl: "https://token.secure-skill.com", modelGroup: "adobe-image2-mid" };
    const descriptor = { id: "gpt-image-2", name: "GPT2", operations: ["image.generate" as const], parameters: [] };
    const model = applySecureSkillImageCapabilities({ provider: "openai", config }, descriptor);
    expect(SECURE_SKILL_IMAGE_PIXELS).toHaveLength(13);
    expect(model.parameters?.find(row => row.key === "size")?.options).toHaveLength(40);
    expect(model.parameters?.find(row => row.key === "size")).toMatchObject({ min: 256, max: 3840, step: 16 });
    expect(model.parameters?.some(row => row.key === "quality")).toBe(false);
    expect(applySecureSkillImageCapabilities({ provider: "openai", config: { ...config, manualProtocol: true } }, descriptor)).toEqual(descriptor);
    expect(secureSkillImageParameterIssues(config, "gpt-image-2", { size: "256x3840" })).toEqual([]);
  });
  it("applies group62's high ceiling by stable identity without limiting group44 or the old group49", () => {
    const config = { baseUrl: "https://token.secure-skill.com", modelGroup: "gpt-image-2.5特价" };
    const parameters = { resolution: "4K", aspect_ratio: "3:1", quality: "max" };
    expect(secureSkillImageParameterIssues({ ...config, accountKeyGroupId: "62", modelGroup: "renamed" }, "gpt-image-2.5-flare", parameters)).toEqual([expect.objectContaining({ path: "parameters.quality" })]);
    for (const accountKeyGroupId of ["44", "49"]) expect(secureSkillImageParameterIssues({ ...config, accountKeyGroupId }, "gpt-image-2.5-flare", parameters)).toEqual([]);
    expect(secureSkillImageParameterIssues(config, "gpt-image-2.5-flare", parameters)).not.toEqual([]);
    expect(isSecureSkillImageConnection({ ...config, manualProtocol: true }, "gpt-image-2")).toBe(false);
    expect(isSecureSkillImageConnection({ ...config, modelCatalogModels: [{ id: "gpt-image-2", metadata: { protocolEvidence: "paid-test" } }] }, "gpt-image-2")).toBe(false);
  });

  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("shows native tiers and exact group62 quality for %s and rejects max before any request", async id => {
    const config = { baseUrl: "https://token.secure-skill.com", modelGroup: "gpt-image-2.5特价", accountKeyGroupId: "62" };
    const model = applySecureSkillImageCapabilities({ provider: "openai", config }, { id, name: id, operations: ["image.generate"], parameters: [], metadata: { imageFixedResolution: "1K", imageSizeContract: "group-1k-only" } });
    expect(model.parameters?.find(p => p.key === "resolution")?.options?.map(o => o.value)).toEqual(["auto", "1K", "2K", "4K"]);
    expect(model.parameters?.find(p => p.key === "aspect_ratio")?.options?.map(o => o.value)).toContain("1:3");
    expect(model.parameters?.find(p => p.key === "size")).toMatchObject({ control: "select", default: "auto", allowCustomValue: false });
    expect(model.parameters?.find(p => p.key === "size")?.options?.every(o => o.value === "auto" || o.label.startsWith("1K"))).toBe(true);
    expect(model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: "high", options: [{ value: "low", label: "low" }, { value: "medium", label: "medium" }, { value: "high", label: "high" }] });
    expect(model.metadata).toMatchObject({ imageNativeResolutionParameter: "resolution", imageQualityOptionsCompleteEnum: true });
    expect(model.metadata).not.toHaveProperty("imageFixedResolution");
    const fetcher = vi.fn<typeof fetch>(), adapter = makeAdapter(fetcher, config.baseUrl, config);
    await expect(adapter.submit({ ...request, model: id, parameters: { resolution: "4K", aspect_ratio: "1:3", quality: "max" } })).rejects.toThrow("最高 high");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(pending());
    await adapter.submit({ ...request, model: id, parameters: { image_size: "4K", aspect_ratio: "auto", quality: "high" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ resolution: "4K", aspect_ratio: "auto", quality: "high" });
    expect(secureSkillImageParameterIssues(config, id, { resolution: "4K", background: "transparent" })).toEqual([expect.objectContaining({ path: "parameters.background" })]);
  });
});
