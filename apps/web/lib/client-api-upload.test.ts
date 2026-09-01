import { beforeEach, describe, expect, it, vi } from "vitest";

const assetDownloadMocks = vi.hoisted(() => ({
  canvasRequestUrlPreferLocal: vi.fn(),
  canvasRequestUrlsWithFallback: vi.fn(),
}));

vi.mock("./asset-download", () => assetDownloadMocks);

import { uploadAsset } from "./client-api";

const uploadId = "d5916e5d-e4f8-4b14-8d71-7a976768c5e3";
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const asset = {
  id: uploadId,
  name: "wechat.png",
  kind: "image" as const,
  mimeType: "image/png",
  size: pngBytes.byteLength,
  storageKey: `assets/${uploadId}/original.png`,
  metadata: {},
  createdAt: "2026-08-24T00:00:00.000Z",
  url: `/api/assets/${uploadId}/content`,
};

describe("proxy asset upload failover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: { origin: "https://815rongai.com", hostname: "815rongai.com" },
    });
    assetDownloadMocks.canvasRequestUrlsWithFallback
      .mockResolvedValueOnce([
        new URL("http://127.0.0.1:3210/api/assets/presign"),
        new URL("https://815rongai.com/api/assets/presign"),
      ])
      .mockResolvedValueOnce([
        new URL(
          `http://127.0.0.1:3210/api/assets/upload?name=wechat.png&id=${uploadId}`,
        ),
        new URL(
          `https://815rongai.com/api/assets/upload?name=wechat.png&id=${uploadId}`,
        ),
      ]);
  });

  it("retries presign through loopback after a public gateway failure", async () => {
    assetDownloadMocks.canvasRequestUrlsWithFallback
      .mockReset()
      .mockResolvedValueOnce([
        new URL("https://815rongai.com/api/assets/presign"),
        new URL("http://127.0.0.1:3210/api/assets/presign"),
      ])
      .mockResolvedValueOnce([
        new URL(
          `http://127.0.0.1:3210/api/assets/upload?name=wechat.png&id=${uploadId}`,
        ),
      ]);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({ mode: "proxy", id: uploadId }, { status: 200 }),
      )
      .mockResolvedValueOnce(Response.json(asset, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const file = new File([pngBytes], "wechat.png", { type: "image/png" });

    await expect(uploadAsset(file)).resolves.toEqual(asset);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("815rongai.com");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("127.0.0.1:3210");
  });

  it("retries the alternate route after a gateway failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ mode: "proxy", id: uploadId }, { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }))
      .mockResolvedValueOnce(Response.json(asset, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const file = new File([pngBytes], "wechat.png", { type: "image/png" });

    await expect(uploadAsset(file)).resolves.toEqual(asset);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ body: file });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ body: file });
  });

  it("does not retry a deterministic media validation error", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ mode: "proxy", id: uploadId }, { status: 200 }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "File content does not match" }, { status: 400 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const file = new File([pngBytes], "wechat.png", { type: "image/png" });

    await expect(uploadAsset(file)).rejects.toThrow(
      "File content does not match",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
