import { describe, expect, it, vi } from "vitest";
import { StaticConnectionResolver } from "./credentials.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";

const contract: RestConnectorConfig = {
  auth: { type: "none" },
  allowedHosts: ["provider.test"],
  submit: {
    path: "/generate", method: "POST", bodyMode: "json", template: {}, idempotent: false,
    response: { taskIdPath: "$.id", statusPath: "$.status" },
  },
  poll: { path: "/jobs/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.status" } },
  output: { kind: "video", path: "$.url", requireOutput: true, contentFallback: { path: "/jobs/{taskId}/content" } },
};

describe("REST post-submission safety", () => {
  it.each(["503", "timeout"] as const)("retains the accepted task when content fallback returns %s", async failure => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "paid-1", status: "succeeded" }));
    if (failure === "503") fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    else fetcher.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([
      { id: "fixture", provider: "rest", baseUrl: "https://provider.test" },
    ]), { config: contract, fetch: fetcher, requestTimeoutMs: 20 });
    await expect(adapter.submit({ connectionId: "fixture", operation: "video.generate", prompt: "fixture", idempotencyKey: "one" }))
      .rejects.toMatchObject({ details: { phase: "archive", retryable: true, submissionMayHaveOccurred: true,
        providerTaskId: "paid-1", ...(failure === "503" ? { status: 503 } : { kind: "timeout" }) } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://provider.test/generate", "POST"], ["https://provider.test/jobs/paid-1/content", "GET"],
    ]);
  });

  it("marks synchronous response parsing failures as accepted and retains their native ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "paid-1", status: "succeeded" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([
      { id: "fixture", provider: "rest", baseUrl: "https://provider.test" },
    ]), { config: contract, fetch: fetcher });
    vi.spyOn(adapter, "extractOutputs").mockRejectedValue(new Error("malformed synchronous output"));
    await expect(adapter.submit({ connectionId: "fixture", operation: "video.generate", prompt: "fixture", idempotencyKey: "one" }))
      .rejects.toMatchObject({ message: "malformed synchronous output", details: {
        kind: "invalid_response", phase: "submit", retryable: false, submissionMayHaveOccurred: true, providerTaskId: "paid-1",
      } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
