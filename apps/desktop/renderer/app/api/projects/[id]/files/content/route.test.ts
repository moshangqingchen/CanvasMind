import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectFileAccessError } from "@super-canvas/storage";

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), read: vi.fn() }));
vi.mock("../../../../../../lib/project-service", () => ({ projectFileMetadata: mocks.metadata, readProjectFile: mocks.read }));
vi.mock("../../../../../../lib/server", () => ({ jsonError: (error: string, status = 400) => Response.json({ error }, { status }) }));
import { GET, HEAD } from "./route";

const context = { params: Promise.resolve({ id: "isolated-project" }) };
const fileId = "a".repeat(64);
const request = (query = "", range?: string) => new Request(`http://localhost/api/projects/isolated-project/files/content?fileId=${fileId}${query}`,
  { headers: range ? { range } : {} });
beforeEach(() => vi.clearAllMocks());

describe("project file media responses", () => {
  it("renders bounded thumbnails once and makes HEAD match cached WebP metadata", async () => {
    const bytes = await sharp({ create: { width: 1000, height: 800, channels: 4, background: "white" } }).png().toBuffer();
    mocks.metadata.mockResolvedValue({ fileId, kind: "image", mimeType: "image/png", size: bytes.length });
    mocks.read.mockResolvedValue({ bytes });
    const response = await GET(request("&preview=640"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const preview = Buffer.from(await response.arrayBuffer());
    expect(await sharp(preview).metadata()).toMatchObject({ width: 640, height: 512 });
    const head = await HEAD(request("&preview=640"), context);
    expect(head.headers.get("content-length")).toBe(String(preview.length));
    expect(head.headers.get("content-type")).toBe("image/webp");
    expect(await head.text()).toBe("");
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.metadata).toHaveBeenCalledTimes(2);
  });
  it("serves validated byte ranges for playable media without reading the full file", async () => {
    mocks.metadata.mockResolvedValue({ fileId, kind: "video", mimeType: "video/mp4", size: 10 });
    mocks.read.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) });
    const response = await GET(request("", "bytes=1-3"), context);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/10");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("isolated-project", fileId, { start: 1, end: 3 });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("revalidates even cached previews and returns 409 for replaced files", async () => {
    mocks.metadata.mockRejectedValue(new ProjectFileAccessError("文件已变化"));
    const response = await GET(request("&preview=640"), context);
    expect(response.status).toBe(409);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
