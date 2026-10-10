import { describe, expect, it, vi } from "vitest";
import type { NormalizedRequest, ProviderTask } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { isSecureSkillSeedreamConnection, secureSkillRequiresPublicAssets } from "./secure-skill-image.js";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const adapter = (fetch: typeof globalThis.fetch, settings: Record<string, unknown> = {}) => createDefaultProviderRegistry(new StaticConnectionResolver([
  { id: "secure", provider: "openai", apiKey: "original-key", baseUrl: "https://token.secure-skill.com/v1", settings: { defaultModel: "seedream-5.0-pro", ...settings } },
]), { fetch }).get("openai");
const request: NormalizedRequest = { connectionId: "secure", operation: "image.generate", model: "seedream-5.0-pro", prompt: "A green leaf", parameters: { size: "1792x768", n: 2 }, idempotencyKey: "only-once" };

describe("Secure Seedream native 202 protocol", () => {
  it("submits once and resumes the original generation with its original Key after restart", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({ id: "native-42", status: "in_progress", poll_url: "/v1/images/generations/native-42" }, 202))
      .mockResolvedValueOnce(json({ id: "native-42", status: "in_progress" }, 202))
      .mockResolvedValueOnce(json({ id: "native-42", status: "succeeded", data: [{ url: "https://cdn.example/a.jpg" }, { url: "https://cdn.example/b.jpg" }] }));
    const initial = await adapter(fetch).submit(request);
    expect(initial).toMatchObject({ providerTaskId: "native-42", status: "running", result: { secureSkillSeedream: true } });
    expect(fetch.mock.calls[0]![0]).toBe("https://token.secure-skill.com/v1/images/generations");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: request.model, prompt: request.prompt, size: "1792x768", n: 2 });
    const restarted = adapter(fetch);
    const running = await restarted.poll!(JSON.parse(JSON.stringify(initial)) as ProviderTask);
    expect(running.status).toBe("running");
    const complete = await restarted.poll!(running);
    expect(complete.status).toBe("succeeded");
    expect(await restarted.extractOutputs(complete.result)).toEqual([{ kind: "image", url: "https://cdn.example/a.jpg" }, { kind: "image", url: "https://cdn.example/b.jpg" }]);
    expect(fetch.mock.calls.slice(1).map(([url, init]) => [url, init?.method, new Headers(init?.headers).get("authorization")])).toEqual([
      ["https://token.secure-skill.com/v1/images/generations/native-42", "GET", "Bearer original-key"],
      ["https://token.secure-skill.com/v1/images/generations/native-42", "GET", "Bearer original-key"],
    ]);
  });
  it("edits using ordered JSON public references and preserves the supplier's dimension precedence", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({ id: "edit-1", status: "in_progress" }, 202));
    await adapter(fetch).submit({ ...request, operation: "image.edit", parameters: { size: "1024x1024", aspect_ratio: "21:9", width: 1111, height: 777, strength: "MID", image_url: "https://cdn.example/one.jpg", image_guidance: [{ url: "https://cdn.example/two.jpg", strength: "HIGH" }], image_urls: ["https://cdn.example/three.jpg"] },
      assets: [{ id: "reference", kind: "image", mimeType: "image/png", url: "http://cdn.example/four.png" }] });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://token.secure-skill.com/v1/images/generations");
    expect(init?.body).not.toBeInstanceOf(FormData);
    expect(JSON.parse(String(init?.body))).toMatchObject({ width: 1111, height: 777, aspect_ratio: "21:9", size: "1024x1024", strength: "MID", image_urls: ["https://cdn.example/three.jpg", "http://cdn.example/four.png"] });
    expect(secureSkillRequiresPublicAssets("openai", { baseUrl: "https://token.secure-skill.com" }, request.model, "image.edit")).toBe(true);
  });
  it.each([
    { size: "0x0" }, { size: "4096x4096" }, { size: "672x1536" }, { width: 1024 }, { width: 1024.5, height: 1024 }, { aspect_ratio: "9:21" },
    { n: 7 }, { n: 2, quantity: 3 }, { strength: "max" }, { stream: false }, { quality: "high" }, { output_format: "png" },
    { image_urls: ["data:image/png;base64,AA=="] }, { image_url: "http://127.0.0.1/a.png" }, { image_url: "https://user:password@cdn.example/a.png" },
    { image_guidance: [{ url: "https://cdn.example/a.png", strength: "WEAK" }] },
    { image_urls: Array.from({ length: 11 }, (_, index) => `https://cdn.example/${index}.png`) },
  ])("rejects invalid native fields before charging: %j", async parameters => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(adapter(fetch).submit({ ...request, parameters })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps account denial and local/mask reference errors instead of enabling the documented model blindly", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(adapter(fetch, { modelScanStatus: "unauthorized" }).submit(request)).rejects.toThrow("可用权限");
    await expect(adapter(fetch).submit({ ...request, operation: "image.edit", assets: [{ id: "local", kind: "image", mimeType: "image/png", data: new Uint8Array([1]) }] })).rejects.toThrow("尚未提交");
    await expect(adapter(fetch).submit({ ...request, operation: "image.edit", assets: [{ id: "mask", role: "mask", kind: "image", mimeType: "image/png", url: "https://cdn.example/mask.png" }] })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ status: "failed", error: { message: "upstream failed" } }, { status: "succeeded", data: [] }])("treats native failure or empty output as a failed task without re-submitting", async output => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({ id: "native-42", status: "in_progress" }, 202)).mockResolvedValueOnce(json(output));
    const a = adapter(fetch);
    expect(await a.poll!(await a.submit(request))).toMatchObject({ status: "failed" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([json({ status: "in_progress" }, 202), json({ error: { message: "upstream unavailable" } }, 502)])("preserves an ambiguous submission without GPT fallback or replay", async response => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response);
    await expect(adapter(fetch).submit(request)).rejects.toMatchObject({ details: { submissionMayHaveOccurred: true, retryable: false } });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("scopes the native protocol to the exact supplier origin and exact ID", () => {
    for (const baseUrl of ["https://token.secure-skill.com.evil.test", "http://token.secure-skill.com", "https://token.secure-skill.com:8443", "https://token.secure-skill.com/custom"]) expect(isSecureSkillSeedreamConnection({ baseUrl }, request.model)).toBe(false);
    expect(isSecureSkillSeedreamConnection({ baseUrl: "https://token.secure-skill.com/v1" }, "seedream-5.0-lite")).toBe(false);
  });
  it.each([
    { seed: 42 }, { negative_prompt: "no lettering" }, { response_format: "b64_json" },
    { image_guidance: [{ url: "https://cdn.example/a.png", weight: 0.7 }] },
    { image_url: "http://localhost./a.png" }, { image_url: "http://printer.local./a.png" },
  ])("rejects unsupported fields or disguised local references before submission: %j", async parameters => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(adapter(fetch).submit({ ...request, parameters })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { canvasRunnable: false, canvasUnavailableReason: "HTTP 403: 当前分组未开通" },
    { publicCatalogOnly: true, canvasRunnable: false },
  ])("preserves exact model account denials even when an old scan still contains the ID: %j", async metadata => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(adapter(fetch, { modelScanStatus: "live", scannedModelIds: [request.model], modelCatalogModels: [{
      id: request.model, name: request.model, operations: ["image.generate"], metadata,
    }] }).submit(request)).rejects.toThrow("可用权限");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("allows harmless UI placeholders while never sending internal size-tier bookkeeping", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({ id: "placeholders", status: "in_progress" }, 202));
    await adapter(fetch).submit({ ...request, parameters: { ...request.parameters, size_tier: "custom", quality: "auto", output_format: "auto", output_compression: "auto" } });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ model: request.model, prompt: request.prompt, size: "1792x768", n: 2 });
  });
  it("revalidates hosted JSON references through the dynamic GenericRest validate call without losing edit inputs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("https://litter.catbox.moe/reference.png"))
      .mockResolvedValueOnce(json({ id: "hosted-edit", status: "in_progress" }, 202));
    const result = await adapter(fetch, { referenceImageHosting: "litterbox-24h" }).submit({ ...request, operation: "image.edit", assets: [
      { id: "local", kind: "image", mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) },
    ] });
    expect(result).toMatchObject({ providerTaskId: "hosted-edit", result: { secureSkillSeedream: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body)).image_urls).toEqual(["https://litter.catbox.moe/reference.png"]);
  });
});
