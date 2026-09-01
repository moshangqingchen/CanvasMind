export const PENDING_RUN_CREATION_GRACE_MS = 60_000;

/**
 * A generated result is eligible for run reconciliation only while its
 * request can still change state. Terminal results may retain historical
 * metadata, but polling them as pending work causes an endless autosave loop.
 */
export function isPendingGeneratedResultStatus(status: unknown): boolean {
  return (
    status === undefined ||
    status === "blocked" ||
    status === "queued" ||
    status === "submitting" ||
    status === "running" ||
    status === "archiving" ||
    status === "cancel_requested"
  );
}

export function shouldMarkPendingRunMissing(input: {
  requestId: string;
  generatedCreatedAt?: string;
  matchedRequestIds: ReadonlySet<string>;
  submittingAtFetchStart: ReadonlySet<string>;
  submittingNow: ReadonlySet<string>;
  now?: number;
}): boolean {
  if (input.matchedRequestIds.has(input.requestId)) return false;
  // A lookup that began while POST /api/runs was still in flight is not an
  // authoritative negative result. The POST may persist the run before this
  // older GET resolves, which previously produced a false orphan error.
  if (
    input.submittingAtFetchStart.has(input.requestId) ||
    input.submittingNow.has(input.requestId)
  )
    return false;

  const createdAt = Date.parse(input.generatedCreatedAt ?? "");
  if (!Number.isFinite(createdAt)) return false;
  return (input.now ?? Date.now()) - createdAt >= PENDING_RUN_CREATION_GRACE_MS;
}
