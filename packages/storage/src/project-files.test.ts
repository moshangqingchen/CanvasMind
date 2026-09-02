import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectFileStore } from "./project-files.js";

async function storeFixture() {
  return new ProjectFileStore({
    root: await mkdtemp(join(tmpdir(), "super-canvas-project-")),
  });
}

const asset = {
  projectName: "李大叔",
  assetId: "asset-1",
  name: "测试图.png",
  mimeType: "image/png",
  kind: "image" as const,
  bytes: new TextEncoder().encode("image"),
};

describe("ProjectFileStore", () => {
  it("renames the project directory without losing archived files", async () => {
    const store = await storeFixture();
    const archived = await store.archiveDraft({ ...asset, source: "external" });
    const currentProject = store.projectDirectory(asset.projectName);
    const nextProject = store.projectDirectory("李大叔的新项目");

    await expect(
      store.renameProject(asset.projectName, "李大叔的新项目"),
    ).resolves.toBe(true);

    await expect(stat(currentProject)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(nextProject)).resolves.toBeTruthy();
    await expect(
      readFile(archived.path.replace(currentProject, nextProject), "utf8"),
    ).resolves.toBe("image");
    await expect(stat(join(nextProject, "成品", "图片"))).resolves.toBeTruthy();
  });

  it("refuses to merge a project into an existing folder", async () => {
    const store = await storeFixture();
    await store.ensureProject("原项目");
    await store.ensureProject("已有项目");

    await expect(store.renameProject("原项目", "已有项目")).rejects.toThrow(
      "目标项目文件夹已存在",
    );
    await expect(stat(store.projectDirectory("原项目"))).resolves.toBeTruthy();
  });

  it("deletes the complete project directory", async () => {
    const store = await storeFixture();
    await store.archiveDraft({ ...asset, source: "external" });
    await store.archiveFinished(asset);
    const project = store.projectDirectory(asset.projectName);

    await expect(store.deleteProject(asset.projectName)).resolves.toBe(true);
    await expect(stat(project)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.deleteProject(asset.projectName)).resolves.toBe(false);
  });

  it("creates separated draft and finished media directories", async () => {
    const store = await storeFixture();
    await store.ensureProject(asset.projectName);
    const project = store.projectDirectory(asset.projectName);
    await expect(stat(join(project, "草稿", "外界素材", "图片"))).resolves.toBeTruthy();
    await expect(stat(join(project, "草稿", "画布生成", "视频"))).resolves.toBeTruthy();
    await expect(stat(join(project, "成品", "音频"))).resolves.toBeTruthy();
  });

  it("deduplicates by asset id and cleanup keeps finished files", async () => {
    const store = await storeFixture();
    await store.archiveDraft({ ...asset, source: "external" });
    const draft = await store.archiveDraft({ ...asset, source: "external" });
    expect(draft.created).toBe(false);
    const renamed = await store.archiveDraft({
      ...asset,
      name: "换一个名字.jpg",
      source: "external",
    });
    expect(renamed.created).toBe(false);
    expect(renamed.path).toBe(draft.path);
    await store.archiveFinished(asset);
    const cleanup = await store.clearDraft(asset.projectName);
    expect(cleanup.failed).toHaveLength(0);
    await expect(stat(store.projectDirectory(asset.projectName) + "\\成品\\图片")).resolves.toBeTruthy();
    const files = await store.archiveFinished(asset);
    await expect(readFile(files.path, "utf8")).resolves.toBe("image");
  });

  it("normalizes unsafe project and file names inside the root", async () => {
    const store = await storeFixture();
    const project = store.projectDirectory("../外部:项目");
    expect(project.startsWith(store.root)).toBe(true);
    const result = await store.archiveDraft({
      ...asset,
      projectName: "../外部:项目",
      name: "..\\bad?.png",
      source: "generated",
    });
    expect(result.path.startsWith(store.root)).toBe(true);
  });
});
