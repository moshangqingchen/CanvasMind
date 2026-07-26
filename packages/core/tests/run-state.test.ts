import { describe, expect, it } from "vitest";

import {
  InvalidNodeRunTransitionError,
  calculateBackoffMs,
  canTransitionNodeRun,
  classifyRetry,
  isTerminalNodeRunStatus,
  transitionNodeRun,
  type NodeRunRecord,
} from "../src/index.js";

const run: NodeRunRecord = {
  id: "node-run-1",
  workflowRunId: "workflow-run-1",
  nodeId: "image",
  status: "queued",
  attempt: 1,
};

describe("node run state machine", () => {
  it("allows only explicit transitions and applies timestamps", () => {
    expect(canTransitionNodeRun("queued", "submitting")).toBe(true);
    expect(canTransitionNodeRun("queued", "succeeded")).toBe(false);

    const submitting = transitionNodeRun(run, "submitting", {
      now: "2026-07-20T12:00:00.000Z",
    });
    expect(submitting.status).toBe("submitting");
    expect(submitting.startedAt).toBe("2026-07-20T12:00:00.000Z");

    expect(() => transitionNodeRun(run, "succeeded")).toThrow(
      InvalidNodeRunTransitionError,
    );
  });

  it("marks settled statuses as terminal while permitting controlled retries", () => {
    expect(isTerminalNodeRunStatus("failed")).toBe(true);
    expect(isTerminalNodeRunStatus("needs_attention")).toBe(true);
    expect(isTerminalNodeRunStatus("running")).toBe(false);
    expect(transitionNodeRun("failed", "queued")).toBe("queued");
    const failed = transitionNodeRun(
      { ...run, status: "submitting" },
      "failed",
      { now: "2026-07-20T12:00:01.000Z" },
    );
    expect(failed.finishedAt).toBe("2026-07-20T12:00:01.000Z");
  });

  it("does not allow a cancellation request to be revived", () => {
    expect(canTransitionNodeRun("cancel_requested", "cancelled")).toBe(true);
    expect(canTransitionNodeRun("cancel_requested", "running")).toBe(false);
    expect(canTransitionNodeRun("cancel_requested", "archiving")).toBe(false);
    expect(canTransitionNodeRun("cancel_requested", "succeeded")).toBe(false);
  });
});

describe("retry safety", () => {
  it("retries rate limiting and known pre-submission network failures", () => {
    expect(
      classifyRetry({ phase: "submit", attempt: 1, statusCode: 429 }),
    ).toMatchObject({
      classification: "retryable",
      action: "retry",
      canResubmit: true,
    });

    expect(
      classifyRetry({
        phase: "submit",
        attempt: 1,
        error: { code: "ECONNREFUSED" },
      }),
    ).toMatchObject({ classification: "retryable", canResubmit: true });
  });

  it("never resubmits when the paid submission outcome is uncertain", () => {
    expect(
      classifyRetry({ phase: "submit", attempt: 1, statusCode: 500 }),
    ).toMatchObject({
      classification: "needs_attention",
      action: "manual_review",
      canResubmit: false,
    });
    expect(
      classifyRetry({
        phase: "submit",
        attempt: 1,
        error: { code: "ECONNRESET" },
      }),
    ).toMatchObject({ classification: "needs_attention" });
    expect(
      classifyRetry({
        phase: "submit",
        attempt: 1,
        error: {
          details: {
            status: 503,
            retryable: false,
            submissionMayHaveOccurred: true,
          },
        },
      }),
    ).toMatchObject({ classification: "needs_attention", canResubmit: false });
    expect(
      classifyRetry({
        phase: "submit",
        attempt: 3,
        maxAttempts: 3,
        submissionOutcome: "unknown",
      }),
    ).toMatchObject({ classification: "needs_attention" });
  });

  it("resumes existing tasks and retries polling without regeneration", () => {
    expect(
      classifyRetry({
        phase: "submit",
        attempt: 1,
        providerTaskId: "provider-task",
        statusCode: 500,
      }),
    ).toMatchObject({
      classification: "retryable",
      action: "resume_poll",
      canResubmit: false,
    });
    expect(
      classifyRetry({ phase: "poll", attempt: 1, statusCode: 503 }),
    ).toMatchObject({ action: "resume_poll", canResubmit: false });
  });

  it("stops at the maximum attempt count and on authentication errors", () => {
    expect(
      classifyRetry({
        phase: "poll",
        attempt: 3,
        statusCode: 503,
      }).classification,
    ).toBe("non_retryable");
    expect(
      classifyRetry({ phase: "submit", attempt: 1, statusCode: 401 })
        .classification,
    ).toBe("non_retryable");
  });

  it("uses deterministic capped exponential backoff unless jitter is requested", () => {
    expect(calculateBackoffMs(1)).toBe(1_000);
    expect(calculateBackoffMs(2)).toBe(2_000);
    expect(calculateBackoffMs(8)).toBe(30_000);
    expect(
      calculateBackoffMs(2, { baseMs: 1_000, jitter: 0.5, random: () => 0 }),
    ).toBe(1_000);
  });
});
