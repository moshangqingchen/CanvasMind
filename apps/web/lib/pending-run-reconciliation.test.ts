import { describe, expect, it } from "vitest";
import {
  PENDING_RUN_CREATION_GRACE_MS,
  isPendingGeneratedResultStatus,
  shouldMarkPendingRunMissing,
} from "./pending-run-reconciliation";

const requestId = "request-1";
const createdAt = "2026-08-24T09:29:16.000Z";
const empty = new Set<string>();

describe("pending run reconciliation", () => {
  it("only polls statuses that can still transition", () => {
    expect(isPendingGeneratedResultStatus("queued")).toBe(true);
    expect(isPendingGeneratedResultStatus("running")).toBe(true);
    expect(isPendingGeneratedResultStatus("failed")).toBe(false);
    expect(isPendingGeneratedResultStatus("needs_attention")).toBe(false);
    expect(isPendingGeneratedResultStatus("succeeded")).toBe(false);
  });

  it("does not trust a stale lookup that started during submission", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: empty,
        submittingAtFetchStart: new Set([requestId]),
        submittingNow: empty,
        now: Date.parse(createdAt) + PENDING_RUN_CREATION_GRACE_MS + 1,
      }),
    ).toBe(false);
  });

  it("allows slow local run creation to finish during the grace period", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: empty,
        submittingAtFetchStart: empty,
        submittingNow: empty,
        now: Date.parse(createdAt) + 6_000,
      }),
    ).toBe(false);
  });

  it("marks a genuinely missing persisted placeholder after the grace period", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: empty,
        submittingAtFetchStart: empty,
        submittingNow: empty,
        now: Date.parse(createdAt) + PENDING_RUN_CREATION_GRACE_MS,
      }),
    ).toBe(true);
  });

  it("never marks a request that has a matching local run", () => {
    expect(
      shouldMarkPendingRunMissing({
        requestId,
        generatedCreatedAt: createdAt,
        matchedRequestIds: new Set([requestId]),
        submittingAtFetchStart: empty,
        submittingNow: empty,
        now: Date.parse(createdAt) + PENDING_RUN_CREATION_GRACE_MS,
      }),
    ).toBe(false);
  });
});
