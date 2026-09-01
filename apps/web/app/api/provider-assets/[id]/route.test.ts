import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderAssetToken } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({
  repository: { getAsset: vi.fn() },
  storage: { head: vi.fn(), get: vi.fn(), getRange: vi.fn() },
}));

vi.mock("../../../../lib/server", () => ({
  repository: mocks.repository,
  storage: mocks.storage,
  jsonError: (message: string, status = 400) =>
    Response.json({ error: message }, { status }),
}));

vi.mock("../../../../lib/master-key", () => ({
  requireServerMasterKey: () => "provider-asset-test-secret",
}));

import { GET, HEAD } from "./route";

describe("signed provider asset route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.getAsset.mockResolvedValue({
      id: "asset-1",
      name: "reference.png",
      kind: "image",
      mimeType: "image/png",
      storageKey: "assets/asset-1/original.png",
    });
    mocks.storage.head.mockResolvedValue({
      size: 3,
      contentType: "image/png",
    });
    mocks.storage.get.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
  });

  it("serves GET and HEAD only with a valid asset-scoped token", async () => {
    const token = createProviderAssetToken({
      assetId: "asset-1",
      secret: "provider-asset-test-secret",
    });
    const context = { params: Promise.resolve({ id: "asset-1" }) };
    const response = await GET(
      new Request(
        `https://canvas.example/api/provider-assets/asset-1?token=${token}`,
      ),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const head = await HEAD(
      new Request(
        `https://canvas.example/api/provider-assets/asset-1?token=${token}`,
        {
          method: "HEAD",
        },
      ),
      context,
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("3");
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const denied = await GET(
      new Request(
        `https://canvas.example/api/provider-assets/asset-2?token=${token}`,
      ),
      { params: Promise.resolve({ id: "asset-2" }) },
    );
    expect(denied.status).toBe(403);
    expect(mocks.repository.getAsset).toHaveBeenCalledTimes(2);
  });
});
