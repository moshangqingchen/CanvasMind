import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { encryptSecret } from "@super-canvas/providers";
import { scanAlternateSupplier } from "./supplier-scan-utils";

const masterKey = "supplier-scan-regression-master-key";
function connection(baseUrl = "https://provider.test"): ProviderConnectionRecord {
  return {
    id: "alternate", name: "Custom instance", provider: "openai",
    config: { supplierKey: "frimodel", baseUrl },
    encryptedSecret: encryptSecret("fixture-key", masterKey),
    createdAt: "2026-09-22", updatedAt: "2026-09-22",
  };
}

beforeEach(() => vi.stubEnv("MASTER_KEY", masterKey));
afterEach(() => vi.unstubAllEnvs());

describe("alternate supplier inventory scanning", () => {
  it.each(["html", "object"])("tries the next endpoint after a successful %s response without an inventory", async (format) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(format === "html" ? new Response("<html>App</html>") : Response.json({ message: "Welcome" }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "gpt-image-2" }] }));
    const result = await scanAlternateSupplier(connection(), { fetch, persist: false });
    expect(result).toMatchObject({ status: "live", modelIds: ["gpt-image-2"] });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://provider.test/v1/models", "https://provider.test/models",
    ]);
    expect(result.canvasDisplayModels[0]?.metadata?.canvasRunnable).toBe(false);
  });

  it("stops after an authentication rejection instead of retrying another endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const result = await scanAlternateSupplier(connection(), { fetch, persist: false });
    expect(result.status).toBe("unauthorized");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts a confirmed empty inventory without probing a different endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [] }));
    const result = await scanAlternateSupplier(connection(), { fetch, persist: false });
    expect(result).toMatchObject({ status: "empty", modelIds: [] });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
