import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadAsset } from "./client-api";
const origin = "http://127.0.0.1:35281";
const id = "d5916e5d-e4f8-4b14-8d71-7a976768c5e3";
describe("desktop asset upload", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { origin } });
    vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("sends the original file directly to the authenticated App origin", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "客户图片 #1.png", { type: "image/png" });
    const asset = { id, name: file.name };
    const fetcher = vi.fn().mockResolvedValue(Response.json(asset, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadAsset(file)).resolves.toEqual(asset);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/api/assets/upload");
    expect(url.searchParams.get("name")).toBe(file.name);
    expect(url.searchParams.get("id")).toBe(id);
    expect(options).toMatchObject({ method: "POST", body: file, mode: "same-origin", credentials: "same-origin" });
  });
  it("preserves media validation errors without submitting the file elsewhere", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "图片文件不完整" }, { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadAsset(new File(["bad"], "bad.png"))).rejects.toThrow("图片文件不完整");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports local service connection failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(uploadAsset(new File(["data"], "image.png"))).rejects.toThrow("素材上传连接失败");
  });
});
