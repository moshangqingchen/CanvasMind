import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@super-canvas/providers";
import { uploadCloudReferences } from "../src/cloud-generation.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock("@super-canvas/providers", async importOriginal => ({ ...await importOriginal<object>(), providerFetch: mocks.fetch }));
const bytes = new Uint8Array([1, 2, 3, 255]), secret = "synthetic-cloud-reference-key";
afterEach(() => { vi.unstubAllEnvs(); mocks.fetch.mockReset(); });

describe("cloud original reference preparation", () => {
  it("uploads and verifies one original once for two role entries without exposing cloud auth in the public GET", async () => {
    vi.stubEnv("MASTER_KEY", secret);
    mocks.fetch.mockImplementation(async (url, init) => {
      if (init?.method === "PUT") {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-cloud-token");
        expect(init.body).toEqual(bytes);
        return Response.json({ url: "https://cloud.test/reference/original?token=synthetic-public-token" });
      }
      expect(String(url)).toBe("https://cloud.test/reference/original?token=synthetic-public-token");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
    });
    const urls = await uploadCloudReferences({ endpoint: "https://cloud.test", encryptedToken: encryptSecret("synthetic-cloud-token", secret) }, "same-run",
      [{ id: "same-original", data: bytes, mimeType: "image/png" }, { id: "same-original", data: bytes, mimeType: "image/png" }]);
    expect(urls).toEqual(["https://cloud.test/reference/original?token=synthetic-public-token", "https://cloud.test/reference/original?token=synthetic-public-token"]);
    expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(1);
    expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("rejects a corrupt cloud reference before any generation can be submitted", async () => {
    vi.stubEnv("MASTER_KEY", secret);
    mocks.fetch.mockImplementation(async (_url, init) => init?.method === "PUT" ? Response.json({ url: "https://cloud.test/reference/original" })
      : new Response(new Uint8Array([9, 2, 3, 255]), { headers: { "content-type": "image/png" } }));
    await expect(uploadCloudReferences({ endpoint: "https://cloud.test", encryptedToken: encryptSecret("synthetic-cloud-token", secret) }, "same-run",
      [{ id: "original", data: bytes, mimeType: "image/png" }])).rejects.toThrow("素材准备失败，尚未提交生成");
    expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
