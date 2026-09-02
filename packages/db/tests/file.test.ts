import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileRepository,
  LOCAL_CANVAS_REVISION_LIMIT,
  LOCAL_RETRYABLE_RUN_LIMIT,
  isRunRecoveryExpired,
} from "../src/file.js";
import { CanvasRevisionConflictError } from "../src/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileRepository", () => {
  it("persists canvas deletion across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const repository = new FileRepository(path);
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: { saved: true } });

    await repository.deleteCanvas(canvas.id);

    const restored = new FileRepository(path);
    await expect(restored.getCanvas(canvas.id)).resolves.toBeNull();
    await expect(restored.listRevisions(canvas.id)).resolves.toEqual([]);
  });

  it("does not persist a stale canvas save or revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const repository = new FileRepository(path);
    const canvas = await repository.ensureDefaultCanvas();

    await repository.saveCanvas({
      id: canvas.id,
      graph: { version: "accepted" },
      expectedRevision: canvas.revision,
    });
    await expect(
      repository.saveCanvas({
        id: canvas.id,
        graph: { version: "stale" },
        expectedRevision: canvas.revision,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CanvasRevisionConflictError>>({
        code: "CANVAS_REVISION_CONFLICT",
        currentRevision: 1,
      }),
    );

    const restored = new FileRepository(path);
    await expect(restored.getCanvas(canvas.id)).resolves.toMatchObject({
      revision: 1,
      graph: { version: "accepted" },
    });
    await expect(restored.listRevisions(canvas.id)).resolves.toHaveLength(1);
  });

  it("caps local canvas revisions across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new FileRepository(path);
    const canvas = await first.ensureDefaultCanvas();

    for (let index = 0; index < LOCAL_CANVAS_REVISION_LIMIT + 5; index += 1) {
      await first.saveCanvas({
        id: canvas.id,
        graph: {
          schemaVersion: 1,
          nodes: [{ id: `node-${index}` }],
          edges: [],
        },
      });
    }

    await expect(first.listRevisions(canvas.id)).resolves.toHaveLength(
      LOCAL_CANVAS_REVISION_LIMIT,
    );
    const restored = new FileRepository(path);
    const revisions = await restored.listRevisions(canvas.id);
    expect(revisions).toHaveLength(LOCAL_CANVAS_REVISION_LIMIT);
    expect(revisions.at(-1)?.graph).toMatchObject({
      nodes: [{ id: `node-${LOCAL_CANVAS_REVISION_LIMIT + 4}` }],
    });
  });

  it("compacts an oversized snapshot when opening the local database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new FileRepository(path);
    const canvas = await first.ensureDefaultCanvas();
    const snapshot = first.exportSnapshot();
    snapshot.revisions = Array.from(
      { length: LOCAL_CANVAS_REVISION_LIMIT + 5 },
      (_, index) => ({
        id: `revision-${index}`,
        canvasId: canvas.id,
        graph: { index },
        reason: "autosave",
        createdAt: new Date(1_700_000_000_000 + index).toISOString(),
      }),
    );
    await writeFile(path, JSON.stringify(snapshot), "utf8");

    const restored = new FileRepository(path);
    await expect(restored.listRevisions(canvas.id)).resolves.toHaveLength(
      LOCAL_CANVAS_REVISION_LIMIT,
    );
    await restored.ensureDefaultCanvas();
    const persisted = JSON.parse(await readFile(path, "utf8")) as {
      revisions: unknown[];
    };
    expect(persisted.revisions).toHaveLength(LOCAL_CANVAS_REVISION_LIMIT);
  });

  it("removes bulky recovery payloads from succeeded local runs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new FileRepository(path);
    const canvas = await first.ensureDefaultCanvas();
    const run = await first.createRun({
      id: "successful-run",
      canvasId: canvas.id,
      clientRequestId: "successful-request",
      scope: "all",
      status: "succeeded",
      revisionGraph: {
        schemaVersion: 1,
        nodes: [{ id: "large-node", data: { value: "x".repeat(10_000) } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    await first.createNodeRun({
      id: "successful-node-run",
      workflowRunId: run.id,
      nodeId: "large-node",
      status: "succeeded",
      attempt: 1,
      providerTaskId: "provider-task",
      inputJson: {
        provider: "rest",
        model: "image-model",
        providerTask: { result: "x".repeat(10_000) },
        historicalInputs: { source: { value: "x".repeat(10_000) } },
      },
      outputAssetIds: ["asset-1"],
      errorJson: null,
    });

    const restored = new FileRepository(path);
    await restored.ensureDefaultCanvas();
    const restoredRun = await restored.getRun(run.id);
    const [restoredNodeRun] = await restored.listNodeRuns(run.id);

    expect(restoredRun?.revisionGraph).toMatchObject({ nodes: [], edges: [] });
    expect(restoredNodeRun?.inputJson).toEqual({
      provider: "rest",
      model: "image-model",
    });
    expect(restoredNodeRun?.outputAssetIds).toEqual(["asset-1"]);
  });

  it("bounds retryable local run snapshots while retaining history rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const repository = new FileRepository(path);
    const canvas = await repository.ensureDefaultCanvas();

    for (let index = 0; index < LOCAL_RETRYABLE_RUN_LIMIT + 2; index += 1) {
      await repository.createRun({
        id: `failed-run-${index}`,
        canvasId: canvas.id,
        clientRequestId: `failed-request-${index}`,
        scope: "all",
        status: "failed",
        revisionGraph: {
          schemaVersion: 1,
          nodes: [{ id: `node-${index}`, data: { value: "x".repeat(1_000) } }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      });
    }

    const restored = new FileRepository(path);
    const runs = await restored.listRuns(canvas.id);
    expect(runs).toHaveLength(LOCAL_RETRYABLE_RUN_LIMIT + 2);
    expect(isRunRecoveryExpired((await restored.getRun("failed-run-0"))!)).toBe(
      true,
    );
    expect(
      isRunRecoveryExpired(
        (await restored.getRun(`failed-run-${LOCAL_RETRYABLE_RUN_LIMIT + 1}`))!,
      ),
    ).toBe(false);
  });

  it("coalesces concurrent snapshot writes without losing durability", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let replacementCount = 0;
    const replaceFile: typeof rename = async (oldPath, newPath) => {
      replacementCount += 1;
      if (replacementCount === 1) await firstWriteBlocked;
      return rename(oldPath, newPath);
    };
    const repository = new FileRepository(path, replaceFile);

    const saves = ["one", "two", "three"].map((id) =>
      repository.saveAsset({
        id,
        name: `${id}.png`,
        kind: "image",
        mimeType: "image/png",
        size: 10,
        storageKey: `assets/${id}/original.png`,
        metadata: {},
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseFirstWrite?.();
    await Promise.all(saves);

    expect(replacementCount).toBe(2);
    const restored = new FileRepository(path);
    await expect(restored.listAssets()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "one" }),
        expect.objectContaining({ id: "two" }),
        expect.objectContaining({ id: "three" }),
      ]),
    );
  });

  it("persists a bulk asset deletion with one snapshot write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    let replacementCount = 0;
    const replaceFile: typeof rename = async (oldPath, newPath) => {
      replacementCount += 1;
      return rename(oldPath, newPath);
    };
    const repository = new FileRepository(path, replaceFile);
    for (const id of ["one", "two", "keep"]) {
      await repository.saveAsset({
        id,
        name: `${id}.png`,
        kind: "image",
        mimeType: "image/png",
        size: 10,
        storageKey: `assets/${id}/original.png`,
        metadata: {},
      });
    }
    const writesBeforeDelete = replacementCount;

    await repository.deleteAssets(["one", "two"]);

    expect(replacementCount).toBe(writesBeforeDelete + 1);
    await expect(repository.listAssets()).resolves.toEqual([
      expect.objectContaining({ id: "keep" }),
    ]);
    const restored = new FileRepository(path);
    await expect(restored.listAssets()).resolves.toEqual([
      expect.objectContaining({ id: "keep" }),
    ]);
  });

  it("restores canvases and assets after creating a new instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new FileRepository(path);
    const canvas = await first.ensureDefaultCanvas();
    await first.saveCanvas({
      id: canvas.id,
      title: "持久画布",
      graph: {
        schemaVersion: 1,
        nodes: [{ id: "image-1" }],
        edges: [],
      },
    });
    await first.saveAsset({
      id: "asset-1",
      name: "result.png",
      kind: "image",
      mimeType: "image/png",
      size: 123,
      storageKey: "assets/asset-1/original.png",
      metadata: {},
    });

    const restored = new FileRepository(path);
    await expect(restored.ensureDefaultCanvas()).resolves.toMatchObject({
      id: canvas.id,
      title: "持久画布",
      revision: 1,
    });
    await expect(restored.listAssets()).resolves.toEqual([
      expect.objectContaining({ id: "asset-1", name: "result.png" }),
    ]);
  });

  it("migrates version 1 files and restores director state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        canvases: [],
        revisions: [],
        assets: [],
        connections: [],
        runs: [],
        nodeRuns: [],
        webhookKeys: [],
      }),
      "utf8",
    );
    const repository = new FileRepository(path);
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveConnection({
      id: "director-brain",
      name: "Director brain",
      provider: "anthropic",
      encryptedSecret: "encrypted",
      config: {},
    });
    await repository.saveDirectorProfile({
      id: "default",
      brainConnectionId: "director-brain",
      brainModelId: "claude-director",
      researchConnectionId: null,
      config: {},
    });
    await repository.createDirectorSession({
      id: "director-session",
      canvasId: canvas.id,
      profileId: "default",
      title: "Director session",
      metadata: {},
    });
    await repository.createDirectorMessage({
      id: "director-message",
      sessionId: "director-session",
      role: "user",
      content: "Make a storyboard",
      metadata: {},
    });
    await repository.createDirectorProposal({
      id: "director-proposal",
      sessionId: "director-session",
      canvasId: canvas.id,
      version: 1,
      status: "awaiting_approval",
      baseCanvasRevision: canvas.revision,
      plan: { nodes: [] },
      quote: { maximum: 0 },
      knowledgeVersion: "knowledge-1",
      catalogFingerprint: "catalog-1",
      expiresAt: "2026-08-30T12:15:00.000Z",
      workflowRunId: null,
    });

    const persisted = JSON.parse(await readFile(path, "utf8")) as {
      version: number;
      directorProfiles: unknown[];
    };
    expect(persisted.version).toBe(2);
    expect(persisted.directorProfiles).toHaveLength(1);

    const restored = new FileRepository(path);
    await expect(restored.getDirectorProfile("default")).resolves.toMatchObject(
      {
        brainConnectionId: "director-brain",
        brainModelId: "claude-director",
      },
    );
    await expect(
      restored.listDirectorMessages("director-session"),
    ).resolves.toEqual([
      expect.objectContaining({ id: "director-message", role: "user" }),
    ]);
    await expect(
      restored.listDirectorProposals("director-session"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "director-proposal",
        status: "awaiting_approval",
      }),
    ]);
  });

  it("continues saving after one persistence failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "super-canvas-db-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    let failNextRename = true;
    const replaceFile: typeof rename = async (oldPath, newPath) => {
      if (!failNextRename) return rename(oldPath, newPath);
      failNextRename = false;
      const error = new Error(
        "simulated persistence failure",
      ) as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    };

    const repository = new FileRepository(path, replaceFile);
    await expect(repository.ensureDefaultCanvas()).rejects.toThrow(
      "simulated persistence failure",
    );
    const canvas = await repository.ensureDefaultCanvas();
    await expect(
      repository.saveCanvas({
        id: canvas.id,
        graph: { schemaVersion: 1, nodes: [], edges: [] },
      }),
    ).resolves.toMatchObject({ revision: 1 });
  });
});
