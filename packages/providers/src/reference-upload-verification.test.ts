import { describe, expect, it, vi } from "vitest";
import { JiasuImageAdapter } from "./jiasu-images.js";
import { GenericRestAdapter, type RestConnectorConfig } from "./rest.js";
import { StaticConnectionResolver } from "./credentials.js";
import { cangyuanCurrentModel, cangyuanCurrentTransport } from "./cangyuan-current-models.js";
import type { NormalizedRequest, ProviderAdapter } from "./contracts.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.1", family: 4 }]) }));
const bytes = new Uint8Array([1, 2, 3, 255]);
const asset = { id: "original", kind: "image" as const, mimeType: "image/png", data: bytes };

function fixture(supplier: "jiasu" | "cangyuan" | "hosting", delivered: () => Response) {
  let paidPosts = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === "GET") {
      expect(new Headers(init.headers).has("authorization")).toBe(false);
      return delivered();
    }
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    if (url.endsWith("/media/uploads")) return Response.json({ success: true, data: { items: [{ url: "https://cdn.test/original.png", put: { url: "https://storage.test/put", method: "PUT" } }] } });
    if (url.endsWith("/images/uploads")) return Response.json({ upload_url: "https://storage.test/put", url: "https://cdn.test/original.png", expires_in: 900, headers: {} });
    if (url.includes("litterbox.catbox.moe")) return new Response("https://litter.catbox.moe/original.png");
    paidPosts++;
    return Response.json({ id: "original-task", status: "running" });
  });
  let adapter: ProviderAdapter;
  const request: NormalizedRequest = { connectionId: "fixture", operation: "image.edit", prompt: "Original unchanged", assets: [asset], idempotencyKey: "one-paid-request" };
  if (supplier === "jiasu") {
    request.model = "gpt-image-2.5-1k";
    adapter = new JiasuImageAdapter(new StaticConnectionResolver([{ id: "fixture", provider: "openai", baseUrl: "https://ai.jiasuapi.com/v1", apiKey: "synthetic-test-token" }]), { fetch });
  } else if (supplier === "cangyuan") {
    const id = "gpt-image-2.5-x", transport = cangyuanCurrentTransport(id)!;
    const connector: RestConnectorConfig = { submit: transport.submit!, output: transport.output!, poll: transport.poll,
      models: [cangyuanCurrentModel({ id, name: id, operations: ["image.generate", "image.edit"] })], modelOverrides: { [id]: transport } };
    request.model = id; request.parameters = { series: "flare", tier: "4k", quality: "max" };
    adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "fixture", provider: "rest", baseUrl: "https://ai.cangyuansuanli.cn/v1", apiKey: "synthetic-test-token", settings: { connector } }]), { fetch });
  } else {
    const connector: RestConnectorConfig = { assetsRequirePublicUrls: true,
      models: [{ id: "hosted", name: "hosted", operations: ["image.edit"] }],
      submit: { path: "/generate", method: "POST", bodyMode: "json", mappings: [{ target: "/images", source: { kind: "assets", select: "all" } }], response: { taskIdPath: "$.id", statusPath: "$.status" } },
      poll: { path: "/tasks/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.status" } },
      output: { path: "$.url", kind: "image" } };
    request.model = "hosted";
    adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "fixture", provider: "rest", baseUrl: "https://provider.test", apiKey: "synthetic-test-token", settings: { connector, referenceImageHosting: "litterbox-24h" } }]), { fetch });
  }
  return { adapter, request, fetch, paidPosts: () => paidPosts };
}

describe.each(["jiasu", "cangyuan", "hosting"] as const)("%s verifies uploaded original before generation", supplier => {
  it.each([
    { kind: "404", response: () => new Response("missing", { status: 404 }) },
    { kind: "HTML", response: () => new Response(bytes, { headers: { "content-type": "text/html" } }) },
    { kind: "same-length corruption", response: () => new Response(new Uint8Array([9, 2, 3, 255]), { headers: { "content-type": "image/png" } }) },
    { kind: "truncation", response: () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }) },
  ])("rejects $kind without a generation POST", async sample => {
    const f = fixture(supplier, sample.response);
    await expect(f.adapter.submit(f.request)).rejects.toThrow("素材准备失败，尚未提交生成");
    expect(f.paidPosts()).toBe(0);
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(1);
  });
  it("allows byte-identical octet-stream delivery and generates exactly once afterward", async () => {
    const f = fixture(supplier, () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
    expect((await f.adapter.submit(f.request)).providerTaskId).toBe("original-task");
    expect(f.paidPosts()).toBe(1);
    const verification = f.fetch.mock.calls.findIndex(([, init]) => init?.method === "GET");
    const generation = f.fetch.mock.calls.findIndex(([url]) => /\/(?:create|edits|generate)$/u.test(String(url)));
    expect(verification).toBeGreaterThanOrEqual(0);
    expect(generation).toBeGreaterThan(verification);
  });
});
