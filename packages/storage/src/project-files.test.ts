import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeProjectName, ProjectFileStore } from "./project-files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function storeFixture() {
  const root = await mkdtemp(join(tmpdir(), "super-canvas-project-"));
  temporaryDirectories.push(root);
  return new ProjectFileStore({ root });
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
  it("orders archive, rename, and a later archive without blocking another project", async () => {
    const store = await storeFixture();
    let writing!: () => void;
    const started = new Promise<void>((resolve) => { writing = resolve; });
    let resume!: () => void;
    const held = new Promise<void>((resolve) => { resume = resolve; });
    const first = store.archiveFinished({ ...asset, bytes: (async function* () {
      writing();
      await held;
      yield new TextEncoder().encode("first");
    })() });
    await started;
    const rename = store.renameProject(asset.projectName, "重命名项目");
    // This is a new explicit write addressed to the old name. It may recreate
    // that directory after the rename, but cannot join the rename's wait set.
    const later = store.archiveFinished({ ...asset, bytes: new TextEncoder().encode("later") });
    let independent;
    try {
      independent = await store.archiveFinished({ ...asset, projectName: "其他项目" });
      expect(await readFile(independent.path, "utf8")).toBe("image");
    } finally { resume(); }
    const [original, changed, last] = await Promise.all([first, rename, later]);
    expect(changed).toBe(true);
    expect(await readFile(original.path.replace(store.projectDirectory(asset.projectName), store.projectDirectory("重命名项目")), "utf8")).toBe("first");
    expect(await readFile(last.path, "utf8")).toBe("later");
  });

  it("continues independent asset writes in the same project while another archive is streaming", async () => {
    const store = await storeFixture();
    let writing!: () => void;
    const started = new Promise<void>((resolve) => { writing = resolve; });
    let resume!: () => void;
    const held = new Promise<void>((resolve) => { resume = resolve; });
    const first = store.archiveFinished({ ...asset, bytes: (async function* () {
      writing();
      await held;
      yield new TextEncoder().encode("first");
    })() });
    await started;
    try {
      const second = await store.archiveFinished({ ...asset, assetId: "asset-2" });
      expect(await readFile(second.path, "utf8")).toBe("image");
    } finally { resume(); }
    await first;
  });

  it.each(["rename", "delete", "clearDraft"] as const)(
    "waits for an in-flight archive before project %s",
    async (operation) => {
      const store = await storeFixture();
      let writing!: () => void;
      const started = new Promise<void>((resolve) => { writing = resolve; });
      let resume!: () => void;
      const held = new Promise<void>((resolve) => { resume = resolve; });
      const archive = store.archiveDraft({
        ...asset, source: "generated",
        bytes: (async function* () {
          yield new TextEncoder().encode("first-");
          writing();
          await held;
          yield new TextEncoder().encode("last");
        })(),
      });
      await started;
      let settled = false;
      const mutation = (operation === "rename"
        ? store.renameProject(asset.projectName, "新项目")
        : operation === "delete"
          ? store.deleteProject(asset.projectName)
          : store.clearDraft(asset.projectName))
        .finally(() => { settled = true; });
      // Observe early rejections while deliberately holding the writer open.
      const results = Promise.allSettled([archive, mutation]);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const settledBeforeWriter = settled;
      resume();
      const [written, changed] = await results;
      expect(settledBeforeWriter).toBe(false);
      expect(written.status).toBe("fulfilled");
      expect(changed.status).toBe("fulfilled");
      if (operation === "rename" && written.status === "fulfilled") {
        const moved = written.value.path.replace(
          store.projectDirectory(asset.projectName), store.projectDirectory("新项目"),
        );
        expect(await readFile(moved, "utf8")).toBe("first-last");
      } else if (operation === "delete") {
        await expect(stat(store.projectDirectory(asset.projectName))).rejects.toMatchObject({ code: "ENOENT" });
      } else if (operation === "clearDraft") {
        expect(await readdir(join(store.projectDirectory(asset.projectName), "草稿", "画布生成", "图片"))).toEqual([]);
      }
    },
  );

  it("archives simultaneous requests for one asset exactly once", async () => {
    const store = await storeFixture();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => store.archiveFinished({
        ...asset,
        name: `版本-${index}.png`,
        bytes: new TextEncoder().encode(`image-${index}`),
      })),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.path)).size).toBe(1);
    const directory = join(store.projectDirectory(asset.projectName), "成品", "图片");
    expect(await readdir(directory)).toHaveLength(1);
    const winner = results.findIndex((result) => result.created);
    expect(await readFile(results[0]!.path, "utf8")).toBe(`image-${winner}`);
  });

  it("normalizes Windows device names and suffixes introduced by truncation", async () => {
    for (const name of ["CON", "aux.txt", "COM1", "lpt9", "NUL"]) {
      const normalized = normalizeProjectName(name);
      expect(normalized).not.toBe(name);
      const store = await storeFixture();
      await expect(store.ensureProject(name)).resolves.toBe(store.projectDirectory(name));
    }
    expect(normalizeProjectName(`${"a".repeat(119)}.suffix`)).not.toMatch(/[. ]$/u);
  });
  it("allows simultaneous workspace reads to create the same project directories", async () => {
    const store = await storeFixture();
    const directories = await Promise.all(Array.from({ length: 12 }, () => store.ensureProject("并发启动")));
    expect(new Set(directories).size).toBe(1);
    expect((await stat(join(directories[0]!, "成品", "图片"))).isDirectory()).toBe(true);
  });
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
    await expect(stat(join(store.projectDirectory(asset.projectName), "成品", "图片"))).resolves.toBeTruthy();
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
