import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, fetchProviderJson, OpenAIImageAdapter, StaticConnectionResolver, withProviderSubmitTransport } from "@super-canvas/providers";
import { cloudSubmissionId, runCloudGeneration } from "../src/cloud-generation.js";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
const config = { endpoint: "https://cloud.example.com", encryptedToken: encryptSecret("a".repeat(48), "local-development-master-key") };
afterEach(() => { vi.unstubAllEnvs(); });
const output = () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("offline-image").toString("base64") }] }), { headers: { "x-supercanvas-response": "1", "content-type": "application/json" } });
function service() {
  let exists = false; let uploaded: RequestInit | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input).endsWith("/response")) return output();
    if (init?.method === "PUT") { uploaded = init; exists = true; return Response.json({ state: "queued" }, { status: 202 }); }
    return exists ? Response.json({ state: "complete" }) : Response.json({}, { status: 404 });
  });
  return { fetch, uploaded: () => uploaded, exists: () => { exists = true; } };
}
describe("cloud generation transport", () => {
  const unreadResponse = (status: number) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel,
    }), { status });
    return { response, cancel };
  };
  it("releases ignored lookup and submit bodies without waiting for cancellation", async () => {
    const missing = unreadResponse(404); const submitted = unreadResponse(202); let query = 0;
    const cloudFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith("/response")) return output();
      if (init?.method === "PUT") return submitted.response;
      return query++ === 0 ? missing.response : Response.json({ state: "complete" });
    });
    await runCloudGeneration("release-unused-bodies", config,
      () => fetchProviderJson(vi.fn(), "https://supplier.example.com/v1/images", { method: "POST", body: "{}" }, { phase: "submit" }),
      { fetch: cloudFetch, delay: async () => {}, checkpoint: async () => {} });
    expect(missing.cancel).toHaveBeenCalledOnce();
    expect(submitted.cancel).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 410, 503])("releases HTTP %s lookup bodies without waiting for cancellation", async status => {
    const responses: ReturnType<typeof unreadResponse>[] = [];
    const cloudFetch = vi.fn<typeof fetch>(async () => {
      const item = unreadResponse(status); responses.push(item); return item.response;
    });
    await expect(runCloudGeneration("release-failed-lookup", config,
      () => fetchProviderJson(vi.fn(), "https://supplier.example.com/v1/images", { method: "POST", body: "{}" }, { phase: "submit" }),
      { fetch: cloudFetch, delay: async () => {}, checkpoint: async () => {} })).rejects.toThrow();
    expect(responses.length).toBeGreaterThan(0);
    for (const item of responses) expect(item.cancel).toHaveBeenCalledOnce();
  });
  it("does not create a cloud job after cancellation during the initial lookup", async () => {
    const controller = new AbortController();
    const cloudFetch = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "PUT") return Response.json({ state: "queued" });
      controller.abort();
      return Response.json({}, { status: 404 });
    });
    await expect(runCloudGeneration("cancel-before-purchase", config,
      () => fetchProviderJson(vi.fn(), "https://supplier.example.com/v1/images", {
        method: "POST", body: "{}", signal: controller.signal,
      }, { phase: "submit" }), {
        fetch: cloudFetch, delay: async () => {}, checkpoint: async () => {},
      })).rejects.toThrow();
    expect(cloudFetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });
  it("distinguishes cloud acceptance, supplier acknowledgement and result transfer", async () => {
    const phases: string[] = []; let accepted = false; let query = 0;
    const states = [{ state: "queued" }, { state: "running" }, { state: "running", phase: "generating" }, { state: "running", phase: "receiving" }, { state: "received" }, { state: "complete" }];
    const cloudFetch = vi.fn<typeof fetch>(async input => String(input).endsWith("/response") ? output() : Response.json(states[Math.min(query++, states.length - 1)]));
    await runCloudGeneration("progress", config, () => fetchProviderJson(vi.fn(), "https://supplier.example.com/v1/images", { method: "POST", body: "{}" }, { phase: "submit" }), {
      fetch: cloudFetch, delay: async () => {}, checkpoint: async () => {}, accepted: async () => { accepted = true; },
      progress: async phase => { expect(accepted).toBe(true); phases.push(phase); },
    });
    expect(phases).toEqual(["cloud_queued", "waiting_provider", "generating", "receiving", "cloud_saving", "downloading"]);
    expect(cloudFetch.mock.calls.every(([,init]) => init?.method !== "PUT")).toBe(true);
  });
  it.each(["image.generate", "image.edit"] as const)("keeps %s parameters and saves a checkpoint before sending", async operation => {
    const cloud = service(); const checkpoint = vi.fn(async () => { expect(cloud.fetch).not.toHaveBeenCalled(); });
    const supplierFetch = vi.fn<typeof fetch>();
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "x", provider: "openai", apiKey: "supplier-secret", baseUrl: "https://asian-acc.we-token.cc/v1", settings: { supplierKey: "weai", modelGroup: "生图-openai-adobe-image2.5专属" } }]), { fetch: supplierFetch });
    const task = await runCloudGeneration("one-request", config, () => adapter.submit({ connectionId: "x", operation, prompt: "Offline test", model: "gpt-image-2.5-sunburst", idempotencyKey: "one-request",
      parameters: { size: "2880x2880", quality: "max" }, ...(operation === "image.edit" ? { assets: [{ id: "ref", kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }] } : {}) }), { fetch: cloud.fetch, checkpoint });
    expect(supplierFetch).not.toHaveBeenCalled(); expect(checkpoint).toHaveBeenCalledOnce();
    const upload = cloud.uploaded()!; const manifest = JSON.parse(Buffer.from(new Headers(upload.headers).get("x-supercanvas-manifest")!, "base64").toString());
    const sent = new Request(manifest.url, { method: manifest.method, headers: manifest.headers, body: upload.body });
    if (operation === "image.edit") { const form = await sent.formData(); expect(form.get("size")).toBe("2880x2880"); expect(form.get("quality")).toBe("max"); expect(form.get("response_format")).toBe("url"); expect(await (form.get("image") as File).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer); }
    else expect(await sent.json()).toMatchObject({ size: "2880x2880", quality: "max", response_format: "url" });
    const images = await adapter.extractOutputs(task.result); expect(Buffer.from(images[0]!.data!).toString()).toBe("offline-image");
  });
  it("resumes an existing job with only reads", async () => {
    const cloud = service(); cloud.exists();
    await runCloudGeneration("same", config, () => fetchProviderJson(vi.fn(), "https://supplier.example.com/v1/images", { method: "POST", body: "{}" }, { phase: "submit" }), { fetch: cloud.fetch, checkpoint: async () => {}, resumeOnly: true });
    expect(cloud.fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
  it("refuses to recreate a missing task on resume", async () => {
    const cloud = service();
    await expect(runCloudGeneration("lost", config, () => fetchProviderJson(vi.fn(), "https://supplier.example.com/v1/images", { method: "POST", body: "{}" }, { phase: "submit" }), { fetch: cloud.fetch, checkpoint: async () => {}, resumeOnly: true })).rejects.toMatchObject({ details: { submissionMayHaveOccurred: true, retryable: false } });
    expect(cloud.fetch.mock.calls).toHaveLength(1);
  });
  it("isolates cloud requests from concurrent local submissions and model queries", async () => {
    const direct = vi.fn(async () => Response.json({ route: "local" }));
    const cloud = vi.fn(async () => Response.json({ route: "cloud" }));
    const values = await Promise.all([
      withProviderSubmitTransport(cloud, () => fetchProviderJson(direct, "https://supplier.example.com/a", {}, { phase: "submit" })),
      fetchProviderJson(direct, "https://supplier.example.com/b", {}, { phase: "submit" }),
      withProviderSubmitTransport(cloud, () => fetchProviderJson(direct, "https://supplier.example.com/models", {}, { phase: "connect" })),
    ]);
    expect(values).toEqual([{ route: "cloud" }, { route: "local" }, { route: "local" }]); expect(cloud).toHaveBeenCalledOnce(); expect(direct).toHaveBeenCalledTimes(2);
  });
  it("uses a stable task marker without exposing the source key", () => { expect(cloudSubmissionId("request-key")).toMatch(/^cloud:[a-f0-9]{64}$/); });
});
