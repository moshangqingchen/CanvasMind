import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ProviderAdapter, RemoteArtifact } from "@super-canvas/providers";
import {
  LocalObjectStorage,
  ProjectFileStore,
  type ObjectStorage,
  type StoredObject,
} from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import * as downloads from "../src/remote-download.js";

afterEach(() => vi.restoreAllMocks());

class MemoryStorage implements ObjectStorage {
  readonly values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.values.set(key, { bytes: bytes.slice(), contentType });
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async head(key: string) {
    const value = this.values.get(key);
    return value
      ? {
          size: value.bytes.byteLength,
          contentType: value.contentType,
          etag: createHash("sha256").update(value.bytes).digest("hex"),
        }
      : null;
  }
}

async function fixture(
  storage: ObjectStorage,
  outputs: RemoteArtifact[],
  projectFileStore: ProjectFileStore | null = null,
) {
  const repository = new MemoryRepository();
  await repository.saveCanvas({
    id: "archive",
    graph: {
      schemaVersion: 1,
      nodes: [
        {
          id: "image",
          type: "workflow",
          data: {
            nodeType: "image-generation",
            provider: "fake",
            connectionId: "fake-default",
            parts: [{ type: "text", text: "fixture" }],
            outputs: [{ id: "output", kind: "image" }],
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  const submit = vi.fn<ProviderAdapter["submit"]>(async (request) => ({
    providerTaskId: request.idempotencyKey,
    status: "succeeded",
    result: {},
  }));
  const adapter: ProviderAdapter = {
    testConnection: async () => {},
    listModels: async () => [],
    validate: async () => ({ valid: true, issues: [] }),
    submit,
    extractOutputs: async () => outputs,
  };
  const service = new RunService({ repository, storage, projectFileStore });
  vi.spyOn(service, "adapters").mockReturnValue(new Map([["fake", adapter]]));
  return { service, repository, submit };
}

async function terminal(service: RunService, id: string) {
  await vi.waitFor(
    async () =>
      expect((await service.getRun(id))?.run.status).not.toMatch(
        /^(queued|running)$/,
      ),
    { timeout: 6000 },
  );
  return (await service.getRun(id))!;
}

describe("artifact checkpoints", () => {
  it.each(["bytes", "data-url", "download"])(
    "does not publish or complete an empty %s output and preserves recovery without resubmitting",
    async (source) => {
      const storage = new MemoryStorage();
      const output: RemoteArtifact =
        source === "bytes"
          ? { kind: "image", data: new Uint8Array(), mimeType: "image/png" }
          : {
              kind: "image",
              url:
                source === "data-url"
                  ? "data:image/png;base64,"
                  : "https://example.test/empty.png",
            };
      if (source === "download")
        vi.spyOn(downloads, "downloadRemoteArtifact").mockResolvedValue({
          bytes: new Uint8Array(),
          contentType: "image/png",
        });
      const { service, repository, submit } = await fixture(storage, [output]);
      const events: unknown[] = [];
      const unsubscribe = service.subscribe((event) => {
        if (event.type === "asset") events.push(event);
      });
      try {
        const run = await service.createRun({
          canvasId: "archive",
          clientRequestId: `empty-${source}`,
          scope: "all",
        });
        const result = await terminal(service, run.id);
        expect(result.run.status).toBe("needs_attention");
        expect(result.nodes[0]).toMatchObject({
          status: "needs_attention",
          outputAssetIds: [],
          errorJson: {
            code: "artifact_archive_failed",
            message: expect.stringContaining("0 字节"),
          },
        });
        expect(result.nodes[0].inputJson.providerTask).toBeDefined();
        expect(await repository.listAssets()).toEqual([]);
        expect(storage.values.size).toBe(0);
        expect(events).toEqual([]);

        // Recovery uses the preserved result; it must never create a second paid task.
        await service.retryRun(run.id);
        expect((await terminal(service, run.id)).run.status).toBe(
          "needs_attention",
        );
        expect(submit).toHaveBeenCalledTimes(1);
      } finally {
        unsubscribe();
      }
    },
  );

  it("rejects and removes an empty streamed output before saving an asset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canvas-empty-stream-"));
    try {
      const storage = new LocalObjectStorage(directory);
      const remove = vi.spyOn(storage, "delete");
      vi.spyOn(downloads, "consumeRemoteArtifact").mockImplementation(
        async (_url, callback) =>
          callback(
            (async function* () {
              yield new Uint8Array();
            })(),
            "image/png",
          ),
      );
      const { service, repository } = await fixture(storage, [
        { kind: "image", url: "https://example.test/empty.png" },
      ]);
      const run = await service.createRun({
        canvasId: "archive",
        clientRequestId: "empty-stream",
        scope: "all",
      });
      const result = await terminal(service, run.id);
      expect(result.run.status).toBe("needs_attention");
      expect(result.nodes[0].errorJson).toMatchObject({
        code: "artifact_archive_failed",
        message: expect.stringContaining("0 字节"),
      });
      expect(await repository.listAssets()).toEqual([]);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(await storage.head(remove.mock.calls[0][0])).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("repairs a failed project mirror on recovery and leaves existing project files unread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "canvas-mirror-repair-"));
    try {
      const storage = new MemoryStorage();
      const get = vi.spyOn(storage, "get");
      const project = new ProjectFileStore({ root: directory });
      const archive = vi.spyOn(project, "archiveDraft");
      archive.mockRejectedValueOnce(
        new Error("fixture project temporarily unavailable"),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      let failSecond = true;
      const download = vi
        .spyOn(downloads, "downloadRemoteArtifact")
        .mockImplementation(async (url) => {
          if (url.endsWith("two") && failSecond)
            throw new Error("fixture unavailable");
          return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" };
        });
      const { service, repository, submit } = await fixture(
        storage,
        [
          { kind: "image", url: "https://example.test/one" },
          { kind: "image", url: "https://example.test/two" },
        ],
        project,
      );
      const events: unknown[] = [];
      const unsubscribe = service.subscribe((event) => {
        if (event.type === "asset") events.push(event);
      });
      try {
        const run = await service.createRun({
          canvasId: "archive",
          clientRequestId: "repair",
          scope: "all",
        });
        expect((await terminal(service, run.id)).run.status).toBe(
          "needs_attention",
        );
        failSecond = false;
        await service.recoverRunOutputs(run.id);
        expect(get).toHaveBeenCalledTimes(1);
        expect(
          download.mock.calls.filter(([url]) => url.endsWith("one")),
        ).toHaveLength(1);
        expect(archive).toHaveBeenCalledTimes(3);
        await service.recoverRunOutputs(run.id);
        expect(get).toHaveBeenCalledTimes(1);
        expect(archive).toHaveBeenCalledTimes(5);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(2);
        expect(await repository.listAssets()).toHaveLength(2);
      } finally {
        unsubscribe();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["intact", "missing", "changed-digest"])(
    "reuses complete outputs only when the local object is %s",
    async (condition) => {
      const storage = new MemoryStorage();
      let failSecond = true;
      const download = vi
        .spyOn(downloads, "downloadRemoteArtifact")
        .mockImplementation(async (url) => {
          if (url.endsWith("two") && failSecond)
            throw new Error("fixture unavailable");
          return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" };
        });
      const { service, repository, submit } = await fixture(storage, [
        { kind: "image", url: "https://example.test/one" },
        { kind: "image", url: "https://example.test/two" },
      ]);
      const run = await service.createRun({
        canvasId: "archive",
        clientRequestId: "checkpoints",
        scope: "all",
      });
      expect((await terminal(service, run.id)).run.status).toBe(
        "needs_attention",
      );
      const assets = await repository.listAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].metadata).toMatchObject({
        archiveComplete: true,
        outputIndex: 0,
      });
      if (condition === "missing") storage.values.delete(assets[0].storageKey);
      if (condition === "changed-digest")
        await storage.put(
          assets[0].storageKey,
          new Uint8Array([9, 8, 7]),
          "image/png",
        );
      failSecond = false;
      await service.retryRun(run.id);
      const recovered = await terminal(service, run.id);
      expect(recovered.run.status).toBe("succeeded");
      expect(recovered.nodes[0].outputAssetIds).toHaveLength(2);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(
        download.mock.calls.filter(([url]) => url.endsWith("one")),
      ).toHaveLength(condition === "intact" ? 1 : 2);
      expect(await repository.listAssets()).toHaveLength(2);
    },
  );

  it("streams a remote result into storage and the project archive without a buffered read", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "canvas-stream-checkpoint-"),
    );
    try {
      const storage = new LocalObjectStorage(directory);
      const get = vi
        .spyOn(storage, "get")
        .mockRejectedValue(
          new Error("Buffered reads are forbidden in this fixture"),
        );
      const bufferedDownload = vi
        .spyOn(downloads, "downloadRemoteArtifact")
        .mockRejectedValue(new Error("Buffered download is forbidden"));
      const consume = vi
        .spyOn(downloads, "consumeRemoteArtifact")
        .mockImplementation(async (_url, callback) =>
          callback(
            (async function* () {
              yield new Uint8Array([1, 2]);
              yield new Uint8Array([3, 4]);
            })(),
            "image/webp",
          ),
        );
      const archived: number[] = [];
      const projectFileStore = {
        archiveDraft: async ({
          bytes,
        }: {
          bytes: Uint8Array | AsyncIterable<Uint8Array>;
        }) => {
          expect(bytes).not.toBeInstanceOf(Uint8Array);
          for await (const chunk of bytes as AsyncIterable<Uint8Array>)
            archived.push(...chunk);
        },
      } as unknown as ProjectFileStore;
      const { service, repository } = await fixture(
        storage,
        [{ kind: "image", url: "https://example.test/image" }],
        projectFileStore,
      );
      const run = await service.createRun({
        canvasId: "archive",
        clientRequestId: "stream",
        scope: "all",
      });
      expect((await terminal(service, run.id)).run.status).toBe("succeeded");
      const [asset] = await repository.listAssets();
      expect(asset).toMatchObject({
        size: 4,
        mimeType: "image/webp",
        metadata: { archiveComplete: true },
      });
      expect(asset.metadata.etag).toBe(
        (await storage.head(asset.storageKey))?.etag,
      );
      expect(archived).toEqual([1, 2, 3, 4]);
      expect(consume).toHaveBeenCalledTimes(1);
      expect(bufferedDownload).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
