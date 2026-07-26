import { describe, expect, it } from "vitest";
import type { NormalizedRequest } from "./contracts";
import { FakeProviderAdapter } from "./fake";
import { ProviderHttpError } from "./http";

function request(
  overrides: Partial<NormalizedRequest> = {},
): NormalizedRequest {
  return {
    connectionId: "fake",
    operation: "image.generate",
    prompt: "A paper-cut city",
    idempotencyKey: "run-1:node-1:attempt-1",
    ...overrides,
  };
}

describe("FakeProviderAdapter", () => {
  it("simulates asynchronous completion and output extraction", async () => {
    const adapter = new FakeProviderAdapter(undefined, {
      pollsBeforeSuccess: 2,
    });
    const submitted = await adapter.submit(request());
    expect(submitted.status).toBe("running");
    expect((await adapter.poll(submitted)).status).toBe("running");
    const completed = await adapter.poll(submitted);
    expect(completed.status).toBe("succeeded");
    expect(await adapter.extractOutputs(completed.result)).toEqual([
      expect.objectContaining({ kind: "image", mimeType: "image/png" }),
    ]);
  });

  it("deduplicates submit calls by idempotency key", async () => {
    const adapter = new FakeProviderAdapter();
    const first = await adapter.submit(request());
    const duplicate = await adapter.submit(
      request({ prompt: "A different prompt" }),
    );
    expect(duplicate.providerTaskId).toBe(first.providerTaskId);
  });

  it("returns one artifact per requested output", async () => {
    const adapter = new FakeProviderAdapter(undefined, {
      defaultScenario: "sync",
    });
    const completed = await adapter.submit(request({ parameters: { n: 3 } }));
    const outputs = await adapter.extractOutputs(completed.result);
    expect(outputs).toHaveLength(3);
    expect(new Set(outputs.map((output) => output.url)).size).toBe(3);
  });

  it("marks an ambiguous submit so the worker can require attention", async () => {
    const adapter = new FakeProviderAdapter();
    await expect(
      adapter.submit(
        request({ metadata: { fakeScenario: "submit_uncertain" } }),
      ),
    ).rejects.toMatchObject({
      details: { submissionMayHaveOccurred: true, retryable: false },
    });
  });

  it("supports cancellation", async () => {
    const adapter = new FakeProviderAdapter();
    const submitted = await adapter.submit(request());
    await adapter.cancel(submitted);
    expect((await adapter.poll(submitted)).status).toBe("cancelled");
  });

  it("recovers a persisted task after the in-memory task map is lost", async () => {
    const firstWorker = new FakeProviderAdapter(undefined, {
      pollsBeforeSuccess: 10,
    });
    const submitted = await firstWorker.submit(request());

    // Simulate a process restart: the new adapter has no task map, but the
    // worker persisted the submitted ProviderTask envelope in node_run.
    const restartedWorker = new FakeProviderAdapter(undefined, {
      pollsBeforeSuccess: 10,
    });
    const recovered = await restartedWorker.poll(submitted);

    expect(recovered.status).toBe("succeeded");
    expect(recovered.progress).toBe(1);
    expect(await restartedWorker.extractOutputs(recovered.result)).toEqual([
      expect.objectContaining({ kind: "image", mimeType: "image/png" }),
    ]);
  });
});
