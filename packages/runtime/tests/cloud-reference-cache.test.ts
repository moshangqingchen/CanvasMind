import { afterEach, expect, it, vi } from "vitest";
import { encryptSecret } from "@super-canvas/providers";
import { uploadCloudReferences } from "../src/cloud-generation.js";
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock("@super-canvas/providers", async importOriginal => ({ ...await importOriginal<object>(), providerFetch: mocks.fetch }));
afterEach(() => { vi.unstubAllEnvs(); mocks.fetch.mockReset(); });
it("uploads one original once and returns its URL in every original role position", async () => {
  vi.stubEnv("MASTER_KEY", "cloud-cache-fixture-key");
  const bytes = new Uint8Array([1, 2, 3]);
  mocks.fetch.mockImplementation(async (_url, init) => {
    if (init?.method === "GET") return new Response(bytes, { headers: { "content-type": "image/png" } });
    expect(init?.method).toBe("PUT"); expect(init?.body).toEqual(bytes);
    return Response.json({ url: "https://cloud.test/reference/original" });
  });
  expect(await uploadCloudReferences({ endpoint: "https://cloud.test", encryptedToken: encryptSecret("synthetic-token", "cloud-cache-fixture-key") }, "one-run",
    [{ id: "same", data: bytes, mimeType: "image/png" }, { id: "same", data: bytes, mimeType: "image/png" }]))
    .toEqual(["https://cloud.test/reference/original", "https://cloud.test/reference/original"]);
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(1);
});
