import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { ProviderAdapter } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import {
  RuntimeScheduler,
  runtimeConcurrency,
  scheduleReadyNodes,
} from "../src/scheduler.js";
import { RunService } from "../src/service.js";
import { validPngBytes } from "./fixtures/image-bytes.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("runtime admission and dependency scheduling", () => {
  it("starts children after their own parent, without waiting for an unrelated branch", async () => {
    const slow = gate();
    const child = gate();
    const started: string[] = [];
    const pending = scheduleReadyNodes(
      ["slow", "fast", "child"],
      new Map([["child", ["fast"]]]),
      2,
      async (id) => {
        started.push(id);
        if (id === "slow") await slow.promise;
        if (id === "child") child.resolve();
        return true;
      },
    );
    await child.promise;
    expect(started).toEqual(["slow", "fast", "child"]);
    slow.resolve();
    expect(await pending).toBe(true);
  });

  it("reserves global, provider and connection limits together and lets another provider progress", async () => {
    const scheduler = new RuntimeScheduler({
      perRun: 4,
      global: 3,
      provider: 2,
      connection: 1,
    });
    const hold = gate();
    const started: string[] = [];
    const launch = (id: string, provider: string, connection: string) =>
      scheduler.withCapacity({ provider, connection }, async () => {
        started.push(id);
        await hold.promise;
      });
    const work = [
      launch("a1", "a", "a1"),
      launch("a1-again", "a", "a1"),
      launch("a2", "a", "a2"),
      launch("a3", "a", "a3"),
      launch("b1", "b", "b1"),
      launch("c1", "c", "c1"),
    ];
    await Promise.resolve();
    expect(started).toEqual(["a1", "a2", "b1"]);
    hold.resolve();
    await Promise.all(work);
    expect(started).toHaveLength(6);
  });

  it("stops scheduling after a lost claim and waits for already started work", async () => {
    const hold = gate();
    const started: string[] = [];
    let finished = false;
    const work = scheduleReadyNodes(
      ["lost", "active", "unstarted"],
      new Map(),
      2,
      async (id) => {
        started.push(id);
        if (id === "active") await hold.promise;
        return id !== "lost";
      },
    ).then((result) => {
      finished = true;
      return result;
    });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(finished).toBe(false);
    hold.resolve();
    expect(await work).toBe(false);
    expect(started).toEqual(["lost", "active"]);
  });

  it("releases quota after errors and validates conservative limits", async () => {
    const scheduler = new RuntimeScheduler({
      perRun: 1,
      global: 1,
      provider: 1,
      connection: 1,
    });
    await expect(
      scheduler.withCapacity({ provider: "a" }, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(
      scheduler.withCapacity({ provider: "a" }, async () => "ok"),
    ).resolves.toBe("ok");
    expect(
      runtimeConcurrency({
        perRun: 0,
        global: -1,
        provider: 65,
        connection: 2,
      }),
    ).toEqual({ perRun: 2, global: 4, provider: 2, connection: 2 });
  });

  it("removes cancelled queued admissions immediately while another run still holds capacity", async () => {
    const scheduler = new RuntimeScheduler({
      perRun: 2,
      global: 1,
      provider: 1,
      connection: 1,
    });
    const hold = gate();
    const first = scheduler.withCapacity({}, () => hold.promise);
    const admission = scheduler.beginRun("cancel-me")!;
    const execute = vi.fn(async () => {});
    const queued = scheduler.withCapacity({}, execute, admission.signal);
    const rejected = expect(queued).rejects.toMatchObject({
      name: "AbortError",
    });
    scheduler.cancelRun("cancel-me");
    await rejected;
    expect(execute).not.toHaveBeenCalled();
    admission.dispose();
    hold.resolve();
    await first;
    await scheduler.withCapacity({}, execute);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

class TestStorage implements ObjectStorage {
  readonly values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.values.set(key, { bytes, contentType });
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async head(key: string) {
    const value = this.values.get(key);
    return value
      ? { size: value.bytes.byteLength, contentType: value.contentType }
      : null;
  }
}

function graph(ids: string[], edges: Array<[string, string]> = []) {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: ids.map((id) => ({
      id,
      type: "workflow",
      data: {
        nodeType: "image-generation",
        provider: "fake",
        connectionId: "fake-default",
        model: "fake-image-v1",
        parts: [{ type: "text", text: id }],
        inputs: [{ id: "input", kind: "image" }],
        outputs: [{ id: "output", kind: "image" }],
      },
    })),
    edges: edges.map(([source, target]) => ({
      id: `${source}-${target}`,
      source,
      target,
      sourceHandle: "output",
      targetHandle: "input",
    })),
  };
}

function adapter(submit: ProviderAdapter["submit"]): ProviderAdapter {
  return {
    testConnection: async () => {},
    listModels: async () => [],
    validate: async () => ({ valid: true, issues: [] }),
    submit,
    extractOutputs: async () => [
      { kind: "image", data: new Uint8Array(validPngBytes), mimeType: "image/png" },
    ],
  };
}

async function terminal(service: RunService, id: string) {
  await vi.waitFor(
    async () =>
      expect((await service.getRun(id))?.run.status).not.toMatch(
        /^(queued|running)$/,
      ),
    { timeout: 5000 },
  );
  return (await service.getRun(id))!;
}

describe("RunService concurrent nodes", () => {
  it("gives one service exclusive ownership when two instances resume the same branched run", async () => {
    const repository = new MemoryRepository();
    const storage = new TestStorage();
    await repository.saveCanvas({
      id: "shared",
      graph: graph(["left", "right"]),
    });
    const first = new RunService({
      repository,
      storage,
      executionMode: "queue",
      enqueueRun: async () => {},
    });
    const second = new RunService({ repository, storage });
    const hold = gate();
    const submitted: string[] = [];
    const adapters = new Map([
      [
        "fake",
        adapter(async (request) => {
          submitted.push(request.idempotencyKey);
          await hold.promise;
          return {
            providerTaskId: request.idempotencyKey,
            status: "succeeded",
            result: {},
          };
        }),
      ],
    ]);
    const firstAdapters = vi.spyOn(first, "adapters").mockReturnValue(adapters);
    const secondAdapters = vi
      .spyOn(second, "adapters")
      .mockReturnValue(adapters);
    const run = await first.createRun({
      canvasId: "shared",
      clientRequestId: "shared",
      scope: "all",
    });
    firstAdapters.mockClear();
    await Promise.all([first.resumeRun(run.id), second.resumeRun(run.id)]);
    try {
      await vi.waitFor(() => expect(submitted).toHaveLength(2));
    } finally {
      hold.resolve();
    }
    expect((await terminal(first, run.id)).run.status).toBe("succeeded");
    expect(new Set(submitted).size).toBe(2);
    expect(
      firstAdapters.mock.calls.length + secondAdapters.mock.calls.length,
    ).toBe(1);
  });

  it("runs independent branches concurrently, blocks only failed descendants, and retains successful work", async () => {
    const repository = new MemoryRepository();
    await repository.saveCanvas({
      id: "parallel",
      graph: graph(
        ["slow", "fail", "blocked", "child"],
        [
          ["fail", "blocked"],
          ["slow", "child"],
        ],
      ),
    });
    const slow = gate();
    const submitted: string[] = [];
    const service = new RunService({
      repository,
      storage: new TestStorage(),
      projectFileStore: null,
    });
    vi.spyOn(service, "adapters").mockReturnValue(
      new Map([
        [
          "fake",
          adapter(async (request) => {
            submitted.push(request.prompt!);
            if (request.prompt === "slow") await slow.promise;
            if (request.prompt === "fail") throw new Error("fixture failed");
            return {
              providerTaskId: request.idempotencyKey,
              status: "succeeded",
              result: {},
            };
          }),
        ],
      ]),
    );
    const run = await service.createRun({
      canvasId: "parallel",
      clientRequestId: "parallel",
      scope: "all",
    });
    try {
      await vi.waitFor(() =>
        expect([...submitted].sort()).toEqual(["fail", "slow"]),
      );
    } finally {
      slow.resolve();
    }
    const result = await terminal(service, run.id);
    expect(result.run.status).toBe("failed");
    expect(
      Object.fromEntries(
        result.nodes.map((node) => [node.nodeId, node.status]),
      ),
    ).toEqual({
      slow: "succeeded",
      fail: "failed",
      blocked: "blocked",
      child: "succeeded",
    });
    expect(submitted).toHaveLength(3);
    expect(submitted[2]).toBe("child");
  });

  it("shares admission across runs and never submits a cancelled queued node", async () => {
    const repository = new MemoryRepository();
    await repository.saveCanvas({ id: "one", graph: graph(["one"]) });
    const hold = gate();
    const submitted: string[] = [];
    const service = new RunService({
      repository,
      storage: new TestStorage(),
      concurrency: { global: 1 },
      projectFileStore: null,
    });
    vi.spyOn(service, "adapters").mockReturnValue(
      new Map([
        [
          "fake",
          adapter(async (request) => {
            submitted.push(request.idempotencyKey);
            await hold.promise;
            return {
              providerTaskId: request.idempotencyKey,
              status: "succeeded",
              result: {},
            };
          }),
        ],
      ]),
    );
    const first = await service.createRun({
      canvasId: "one",
      clientRequestId: "one",
      scope: "all",
    });
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    const second = await service.createRun({
      canvasId: "one",
      clientRequestId: "two",
      scope: "all",
    });
    await service.cancelRun(second.id);
    hold.resolve();
    await terminal(service, first.id);
    await terminal(service, second.id);
    expect(submitted).toHaveLength(1);
    expect((await repository.listNodeRuns(second.id))[0]?.status).toBe(
      "cancelled",
    );
  });
});
