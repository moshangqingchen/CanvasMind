import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { collectReferencedAssetIds } from "../src/asset-references.js";
import { MemoryRepository } from "../src/memory.js";
import { FileRepository } from "../src/file.js";

const asset = (id: string) => ({ id, name: id, kind: "image" as const, mimeType: "image/png", size: 1, storageKey: id, metadata: {} });
const graph = (assetId: string) => ({ nodes: [{ data: { assetId } }], edges: [] });

it("collects every existing durable reference field and safely ignores arbitrary legacy graphs", () => {
  for (const legacy of [null, "legacy", {}, { nodes: null }, { nodes: [null, 1, {}, { data: null }] }]) expect(collectReferencedAssetIds(legacy)).toEqual([]);
  const ids = ["asset", "design", "mask", "mask-source", "generated-mask", "generated-mask-source", "detail-mask", "detail-source", "detail-input", "detail-asset", "last", "materialized", "customer", "reference", "customer-object", "part", "generated-part", "legacy-prompt"];
  expect(collectReferencedAssetIds({ nodes: [{ data: {
    assetId: ids[0], designSourceAssetId: ids[1], parameters: { maskAssetId: ids[2], maskSourceAssetId: ids[3] }, generatedParameters: { maskAssetId: ids[4], maskSourceAssetId: ids[5] },
    generatedDetails: { imageMask: { maskAssetId: ids[6], maskSourceAssetId: ids[7] }, inputAssetIds: [ids[8]], inputAssets: [{ id: ids[9] }] },
    lastOutputAssetIds: [ids[10]], materializedOutputAssetIds: [ids[11]], graphicDesignBrief: { customerImageAssetIds: [ids[12]], references: [{ assetId: ids[13] }], customerImages: [{ assetId: ids[14] }] },
    parts: [{ type: "asset", assetId: ids[15] }], generatedPromptParts: [{ type: "asset", assetId: ids[16] }], prompt: [{ type: "asset", assetId: ids[17] }],
  } }] })).toEqual([...ids].sort());
});

it("blocks new references only to rollback-cleaned assets and permits restoring a real new original", async () => {
  const repository = new MemoryRepository();
  await repository.saveAsset(asset("rollback")); await repository.saveAsset(asset("manual"));
  await repository.deleteUnreferencedAssets(["rollback"]); await repository.deleteAsset("manual");
  await expect(repository.saveCanvas({ id: "late", graph: graph("rollback") })).rejects.toThrow("未引用回滚清理");
  await expect(repository.saveCanvas({ id: "legacy-prompt-late", graph: { nodes: [{ data: { prompt: [{ type: "asset", assetId: "rollback" }] } }] } })).rejects.toThrow("未引用回滚清理");
  expect(await repository.getCanvas("late")).toBeNull();
  await expect(repository.saveCanvas({ id: "manual", graph: graph("manual") })).resolves.toMatchObject({ id: "manual" });
  await expect(repository.saveCanvas({ id: "legacy", graph: graph("never-existed") })).resolves.toMatchObject({ id: "legacy" });
  await repository.saveAsset(asset("rollback"));
  await expect(repository.saveCanvas({ id: "restored", graph: graph("rollback") })).resolves.toMatchObject({ id: "restored" });
});

it("protects legacy prompt-array asset references in both current graphs and retained revisions", async () => {
  const repository = new MemoryRepository();
  for (const id of ["current", "revision"]) await repository.saveAsset(asset(id));
  const promptGraph = (assetId: string) => ({ nodes: [{ data: { prompt: [{ type: "asset", assetId, role: "reference" }] } }], edges: [] });
  await repository.saveCanvas({ id: "legacy-current", graph: promptGraph("current") });
  await repository.saveCanvas({ id: "legacy-history", graph: promptGraph("revision") });
  await repository.saveCanvas({ id: "legacy-history", graph: { nodes: [], edges: [] } });
  expect(await repository.deleteUnreferencedAssets(["current", "revision"])).toEqual({ deletedIds: [], referencedIds: ["current", "revision"] });
  expect(await repository.getAsset("current")).not.toBeNull(); expect(await repository.getAsset("revision")).not.toBeNull();
});

it("rejects concurrent references while rollback persistence is pending and after reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-rollback-fence-"));
  try {
    let hold = false, entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const path = join(root, "state.json"), repository = new FileRepository(path, async (oldPath, newPath) => {
      if (hold) { entered(); await gate; }
      return rename(oldPath, newPath);
    });
    await repository.saveAsset(asset("rollback")); hold = true;
    const cleanup = repository.deleteUnreferencedAssets(["rollback"]); await waiting;
    await expect(repository.saveCanvas({ id: "racing", graph: graph("rollback") })).rejects.toThrow("未引用回滚清理");
    release(); await cleanup; hold = false;
    const reloaded = new FileRepository(path);
    await expect(reloaded.saveCanvas({ id: "after-restart", graph: graph("rollback") })).rejects.toThrow("未引用回滚清理");
    expect(await reloaded.listCanvases()).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("preserves an already dangling legacy reference without permitting it in another canvas", async () => {
  const repository = new MemoryRepository();
  await repository.saveAsset(asset("old")); const previous = await repository.saveCanvas({ id: "legacy", graph: graph("old") });
  const snapshot = repository.exportSnapshot();
  snapshot.assets[0] = { ...snapshot.assets[0]!, deleted: true, metadata: { rollbackCleanup: true } };
  const restored = new MemoryRepository(snapshot);
  await expect(restored.saveCanvas({ id: previous.id, graph: { ...graph("old"), viewport: { x: 1 } } })).resolves.toMatchObject({ id: previous.id });
  await expect(restored.saveCanvas({ id: "new", graph: graph("old") })).rejects.toThrow("未引用回滚清理");
});

it("admits rollback cleanup behind the existing durable catalog publication barrier", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-rollback-catalog-fence-"));
  try {
    let hold = false, entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const path = join(root, "state.json"), repository = new FileRepository(path, async (oldPath, newPath) => {
      if (hold) { entered(); await gate; }
      return rename(oldPath, newPath);
    });
    await repository.saveAsset(asset("rollback")); hold = true;
    const catalog = repository.setApplicationSetting("fixture", "new-value"); await waiting;
    const cleanup = repository.deleteUnreferencedAssets(["rollback"]);
    expect(await repository.getAsset("rollback")).not.toBeNull();
    release(); await Promise.all([catalog, cleanup]);
    const reloaded = new FileRepository(path);
    expect(await reloaded.getApplicationSetting("fixture")).toBe("new-value");
    await expect(reloaded.saveCanvas({ id: "late", graph: graph("rollback") })).rejects.toThrow("未引用回滚清理");
  } finally { await rm(root, { recursive: true, force: true }); }
});
