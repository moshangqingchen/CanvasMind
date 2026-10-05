import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn(), importFiles: vi.fn() }));
vi.mock("../../../../../lib/project-service", () => ({ listProjectFiles: mocks.list, deleteProjectFiles: mocks.remove, importProjectFiles: mocks.importFiles }));
vi.mock("../../../../../lib/server", () => ({ jsonError: (error: string, status = 400) => Response.json({ error }, { status }), publicAsset: (asset: unknown) => asset }));
import { GET } from "./route";
import { POST as remove } from "./delete/route";
import { POST as importFiles } from "./import/route";
const context = { params: Promise.resolve({ id: "project" }) };
const fileId = "a".repeat(64), otherId = "b".repeat(64);
const request = (fileIds: string[]) => new Request("http://localhost/api/projects/project/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileIds }) });
beforeEach(() => vi.clearAllMocks());
describe("scoped project file APIs", () => {
  it("lists only the selected project and disables shared caching", async () => {
    mocks.list.mockResolvedValue({ files: [], ignoredFiles: 0 });
    const response = await GET(new Request("http://localhost"), context);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("project");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ files: [], ignoredFiles: 0 });
  });
  it("rejects client paths and oversized batches before any deletion or import", async () => {
    expect((await remove(request(["../private.png"]), context)).status).toBe(400);
    expect((await importFiles(request(Array.from({ length: 101 }, () => fileId)), context)).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.importFiles).not.toHaveBeenCalled();
  });
  it("reports partial deletions and returns 409 when no selected version can be deleted", async () => {
    mocks.remove.mockResolvedValue({ deletedIds: [fileId], failed: [{ fileId: otherId, message: "文件已变化" }] });
    const partial = await remove(request([fileId, otherId]), context);
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({ deletedIds: [fileId], failed: [{ fileId: otherId }] });
    mocks.remove.mockResolvedValue({ deletedIds: [], failed: [{ fileId, message: "文件已变化" }] });
    expect((await remove(request([fileId]), context)).status).toBe(409);
  });
  it("returns assets and per-file import failures independently", async () => {
    mocks.importFiles.mockResolvedValue({ assets: [{ id: "asset" }], failed: [{ fileId: otherId, error: "文件已变化" }] });
    const response = await importFiles(request([fileId, otherId]), context);
    expect(await response.json()).toEqual({ assets: [{ id: "asset" }], failed: [{ fileId: otherId, error: "文件已变化" }] });
    expect(mocks.importFiles).toHaveBeenCalledExactlyOnceWith("project", [fileId, otherId]);
  });
});
