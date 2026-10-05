import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { isSecureSkillImageConnection } from "./secure-skill-image.js";
import type { NormalizedRequest, ProviderTask } from "./contracts.js";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pending = () => response({ code: "success", data: { task_id: "img-test", status: "PENDING" } });
const makeAdapter = (fetcher: typeof fetch, baseUrl = "https://token.secure-skill.com/v1") =>
  createDefaultProviderRegistry(new StaticConnectionResolver([{
    id: "secure", provider: "openai", baseUrl, apiKey: "test-key",
    settings: { defaultModel: "gpt-image-2.5-flare", supplierKey: "custom-supplier-id" },
  }]), { fetch: fetcher }).get("openai");
const request: NormalizedRequest = {
  connectionId: "secure", model: "gpt-image-2.5-flare", operation: "image.edit", prompt: "Keep the reference subject",
  idempotencyKey: "paid-once", parameters: { size: "3840x2160", quality: "max" },
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
    expect(JSON.parse(String(init?.body))).toEqual({ model, prompt: request.prompt, size: "3840x2160", quality, response_format: "url",
      image: ["https://assets.example.com/reference.png", "https://assets.example.com/second.jpg"], ...(model === "gpt-image-2" ? { background: "opaque" } : {}) });
  });

  it("omits references for generation and omits auto sentinels", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(pending());
    await makeAdapter(fetcher, "https://token.secure-skill.com").submit({ ...request, model: undefined, operation: "image.generate", assets: [], parameters: { size: "auto", quality: "auto" } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ model: "gpt-image-2.5-flare", prompt: request.prompt, response_format: "url" });
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
});
