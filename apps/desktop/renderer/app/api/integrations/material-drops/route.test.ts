import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bytes: new Uint8Array(), put: vi.fn(), saveAsset: vi.fn(), preview: vi.fn() }));
vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  realpath: async (p: string) => p,
  stat: async () => ({ isFile: () => true, size: mocks.bytes.length }),
  readFile: async (p: string) => p.endsWith(".super-canvas-bridge-token") ? "fixture-token" : mocks.bytes,
}));
vi.mock("../../../../lib/server", () => ({
  repository: { saveAsset: mocks.saveAsset }, storage: { put: mocks.put },
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
}));
vi.mock("../../../../lib/asset-preview", () => ({ assetPreviewKey: () => "preview", getOrCreateAssetPreview: mocks.preview }));
import { POST, PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("USERPROFILE", "D:/audit-material-fixture");
  mocks.saveAsset.mockImplementation(async asset => asset);
  mocks.preview.mockResolvedValue(new Uint8Array());
});
afterEach(() => vi.unstubAllEnvs());

async function claim(name: string, mimeType: string) {
  const response = await POST(new Request("http://localhost/api/integrations/material-drops", { method: "POST", body: JSON.stringify({
    token: "fixture-token", filePath: path.resolve("D:/audit-material-fixture/Documents/素材管理库/assets", name),
    name, mimeType, size: mocks.bytes.length, screenX: 1, screenY: 1,
  }) }));
  expect(response.status).toBe(202);
  const { id } = await response.json();
  return PATCH(new Request("http://localhost/api/integrations/material-drops", { method: "PATCH", body: JSON.stringify({ id }) }));
}

it("keeps all animated GIF bytes as original.gif while previews remain separate", async () => {
  const pixels = Buffer.alloc(3 * 6 * 4, 255);
  for (let index = 0; index < 18; index++) pixels.set(index < 9 ? [255, 0, 0, 255] : [0, 0, 255, 255], index * 4);
  mocks.bytes = new Uint8Array(await sharp(pixels, { raw: { width: 3, height: 6, pageHeight: 3, channels: 4 } })
    .gif({ delay: [100, 200], loop: 2 }).toBuffer());
  expect((await sharp(mocks.bytes, { animated: true }).metadata()).pages).toBe(2);
  const response = await claim("animation.gif", "image/gif");
  expect(response.status).toBe(200);
  const asset = await response.json();
  expect(asset).toMatchObject({ mimeType: "image/gif", name: "animation.gif", size: mocks.bytes.length });
  expect(asset.storageKey).toMatch(/original\.gif$/u);
  const stored = mocks.put.mock.calls[0]![1] as Uint8Array;
  expect(createHash("sha256").update(stored).digest("hex")).toBe(createHash("sha256").update(mocks.bytes).digest("hex"));
  expect(mocks.put.mock.calls[0]![2]).toBe("image/gif");
  expect(mocks.preview).toHaveBeenCalled();
});

it("rejects an incomplete GIF instead of re-encoding its original", async () => {
  mocks.bytes = new TextEncoder().encode("GIF89a incomplete");
  expect((await claim("broken.gif", "image/gif")).status).toBe(415);
  expect(mocks.put).not.toHaveBeenCalled();
});

it("keeps the existing PNG original path", async () => {
  mocks.bytes = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).png().toBuffer());
  expect((await claim("still.png", "image/png")).status).toBe(200);
  expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/original\.png$/u), mocks.bytes, "image/png");
});
