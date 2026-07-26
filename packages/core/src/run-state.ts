import type {
  BackoffOptions,
  NodeRunRecord,
  NodeRunStatus,
  NodeRunTransitionOptions,
  RetryContext,
  RetryDecision,
} from "./types.js";

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 1_000;
export const DEFAULT_RETRY_MAX_MS = 30_000;

export const NODE_RUN_TRANSITIONS = {
  blocked: ["queued", "failed", "cancel_requested", "cancelled"],
  queued: ["submitting", "failed", "cancel_requested", "cancelled"],
  submitting: [
    "running",
    "archiving",
    "failed",
    "cancel_requested",
    "needs_attention",
  ],
  running: ["archiving", "failed", "cancel_requested", "needs_attention"],
  archiving: ["succeeded", "failed", "cancel_requested", "needs_attention"],
  succeeded: [],
  failed: ["queued"],
  // Once cancellation has been requested, only provider cancellation
  // reconciliation may settle the node. Late poll/webhook results must not
  // revive it or mark it successful.
  cancel_requested: ["cancelled"],
  cancelled: [],
  needs_attention: ["queued", "failed", "cancel_requested", "cancelled"],
} as const satisfies Readonly<Record<NodeRunStatus, readonly NodeRunStatus[]>>;

export const TERMINAL_NODE_RUN_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "needs_attention",
] as const satisfies readonly NodeRunStatus[];

export class InvalidNodeRunTransitionError extends Error {
  readonly from: NodeRunStatus;
  readonly to: NodeRunStatus;

  constructor(from: NodeRunStatus, to: NodeRunStatus) {
    super(`Invalid node run transition: ${from} -> ${to}`);
    this.name = "InvalidNodeRunTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransitionNodeRun(
  from: NodeRunStatus,
  to: NodeRunStatus,
): boolean {
  return (NODE_RUN_TRANSITIONS[from] as readonly NodeRunStatus[]).includes(to);
}

export const canTransition = canTransitionNodeRun;
export const canTransitionNodeRunStatus = canTransitionNodeRun;

export function isTerminalNodeRunStatus(status: NodeRunStatus): boolean {
  return (TERMINAL_NODE_RUN_STATUSES as readonly NodeRunStatus[]).includes(
    status,
  );
}

function toIsoTimestamp(value: Date | string | number | undefined): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Invalid transition timestamp");
  }
  return date.toISOString();
}

export function transitionNodeRun(
  current: NodeRunStatus,
  nextStatus: NodeRunStatus,
  options?: NodeRunTransitionOptions,
): NodeRunStatus;
export function transitionNodeRun(
  current: NodeRunRecord,
  nextStatus: NodeRunStatus,
  options?: NodeRunTransitionOptions,
): NodeRunRecord;
export function transitionNodeRun(
  current: NodeRunStatus | NodeRunRecord,
  nextStatus: NodeRunStatus,
  options: NodeRunTransitionOptions = {},
): NodeRunStatus | NodeRunRecord {
  const currentStatus = typeof current === "string" ? current : current.status;
  if (!canTransitionNodeRun(currentStatus, nextStatus)) {
    throw new InvalidNodeRunTransitionError(currentStatus, nextStatus);
  }

  if (typeof current === "string") {
    return nextStatus;
  }

  const now = toIsoTimestamp(options.now);
  const next: NodeRunRecord = {
    ...current,
    status: nextStatus,
    updatedAt: now,
    ...(options.error === undefined ? {} : { error: options.error }),
    ...(options.providerTaskId === undefined
      ? {}
      : { providerTaskId: options.providerTaskId }),
  };

  if (
    (nextStatus === "submitting" || nextStatus === "running") &&
    current.startedAt == null
  ) {
    return { ...next, startedAt: now };
  }

  if (isTerminalNodeRunStatus(nextStatus)) {
    return { ...next, finishedAt: now };
  }

  if (nextStatus === "queued" && currentStatus !== "blocked") {
    return { ...next, error: null, finishedAt: null };
  }

  return next;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function getNestedRecord(
  record: UnknownRecord | undefined,
  key: string,
): UnknownRecord | undefined {
  return asRecord(record?.[key]);
}

function readStatusCode(context: RetryContext): number | undefined {
  if (context.statusCode !== undefined) {
    return context.statusCode;
  }
  const error = asRecord(context.error);
  const response = getNestedRecord(error, "response");
  const details = getNestedRecord(error, "details");
  for (const value of [
    error?.["statusCode"],
    error?.["status"],
    response?.["status"],
    details?.["statusCode"],
    details?.["status"],
  ]) {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
  }
  return undefined;
}

function readErrorCode(errorValue: unknown): string | undefined {
  const error = asRecord(errorValue);
  const details = getNestedRecord(error, "details");
  const value =
    error?.["code"] ??
    getNestedRecord(error, "cause")?.["code"] ??
    getNestedRecord(details, "cause")?.["code"];
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

function readErrorName(errorValue: unknown): string | undefined {
  const value = asRecord(errorValue)?.["name"];
  return typeof value === "string" ? value : undefined;
}

function explicitRetryable(errorValue: unknown): boolean | undefined {
  const error = asRecord(errorValue);
  const value =
    error?.["retryable"] ?? getNestedRecord(error, "details")?.["retryable"];
  return typeof value === "boolean" ? value : undefined;
}

function inferredSubmissionOutcome(
  context: RetryContext,
): RetryContext["submissionOutcome"] {
  if (context.submissionOutcome !== undefined) return context.submissionOutcome;
  const value = getNestedRecord(asRecord(context.error), "details")?.[
    "submissionMayHaveOccurred"
  ];
  if (value === true) return "unknown";
  if (value === false) return "not_submitted";
  return undefined;
}

const SAFE_PRE_SUBMISSION_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const AMBIGUOUS_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const OTHER_NETWORK_CODES = new Set([
  "ENETDOWN",
  "EHOSTDOWN",
  "ERR_NETWORK",
  "FETCH_ERROR",
]);

function isNetworkFailure(errorValue: unknown, errorCode?: string): boolean {
  if (
    errorCode !== undefined &&
    (SAFE_PRE_SUBMISSION_NETWORK_CODES.has(errorCode) ||
      AMBIGUOUS_NETWORK_CODES.has(errorCode) ||
      OTHER_NETWORK_CODES.has(errorCode))
  ) {
    return true;
  }

  const error = asRecord(errorValue);
  const name = typeof error?.["name"] === "string" ? error["name"] : "";
  const message =
    typeof error?.["message"] === "string" ? error["message"] : "";
  return (
    name === "FetchError" ||
    name === "NetworkError" ||
    name === "TimeoutError" ||
    (name === "TypeError" && /fetch|network|socket/i.test(message))
  );
}

function retry(
  action: RetryDecision["action"],
  reason: string,
  canResubmit = false,
): RetryDecision {
  return {
    classification: "retryable",
    action,
    retryable: true,
    canResubmit,
    reason,
  };
}

function fail(reason: string): RetryDecision {
  return {
    classification: "non_retryable",
    action: "fail",
    retryable: false,
    canResubmit: false,
    reason,
  };
}

function manualReview(reason: string): RetryDecision {
  return {
    classification: "needs_attention",
    action: "manual_review",
    retryable: false,
    canResubmit: false,
    reason,
  };
}

export function classifyRetry(context: RetryContext): RetryDecision {
  const maxAttempts = context.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(context.attempt) || context.attempt < 1) {
    throw new RangeError("attempt must be a positive integer");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  const providerTaskId = context.providerTaskId?.trim();
  if (context.phase === "submit" && providerTaskId) {
    return retry(
      "resume_poll",
      "A provider task already exists; resume polling without resubmitting",
    );
  }

  const submissionOutcome = inferredSubmissionOutcome(context);
  if (context.phase === "submit" && submissionOutcome === "submitted") {
    return manualReview(
      "The request was submitted but no resumable provider task id is available",
    );
  }
  if (context.phase === "submit" && submissionOutcome === "unknown") {
    return manualReview(
      "Submission outcome is unknown; automatic resubmission could duplicate charges",
    );
  }

  if (context.attempt >= maxAttempts) {
    return fail(`Maximum attempt count (${maxAttempts}) reached`);
  }

  const statusCode = readStatusCode(context);
  const errorCode = readErrorCode(context.error);
  const errorName = readErrorName(context.error);
  const retryableFlag = explicitRetryable(context.error);
  const networkFailure = isNetworkFailure(context.error, errorCode);

  if (errorName === "AbortError" || errorCode === "ABORT_ERR") {
    return fail("The operation was deliberately aborted");
  }

  if (statusCode === 401 || statusCode === 403) {
    return fail(`Provider authentication failed with HTTP ${statusCode}`);
  }
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return fail(`Provider rejected the request with HTTP ${statusCode}`);
  }
  if (retryableFlag === false) {
    return fail("The provider marked the error as non-retryable");
  }

  if (context.phase !== "submit") {
    const action = context.phase === "poll" ? "resume_poll" : "resume_archive";
    if (
      statusCode === 408 ||
      statusCode === 429 ||
      (statusCode !== undefined && statusCode >= 500) ||
      networkFailure ||
      retryableFlag === true
    ) {
      return retry(
        action,
        `${context.phase} can be retried without a new generation`,
      );
    }
    return fail(`The ${context.phase} error is not classified as transient`);
  }

  if (statusCode === 429) {
    return retry(
      "retry",
      "Provider rate limit response is safe to resubmit",
      true,
    );
  }

  const definitelyNotSubmitted = submissionOutcome === "not_submitted";
  if (definitelyNotSubmitted) {
    if (
      statusCode === 408 ||
      (statusCode !== undefined && statusCode >= 500) ||
      networkFailure ||
      retryableFlag === true
    ) {
      return retry(
        "retry",
        "The transient failure happened before provider submission",
        true,
      );
    }
    return fail(
      "The request was not submitted, but the error is not transient",
    );
  }

  if (
    errorCode !== undefined &&
    SAFE_PRE_SUBMISSION_NETWORK_CODES.has(errorCode)
  ) {
    return retry(
      "retry",
      `Network failure ${errorCode} occurred before a connection was established`,
      true,
    );
  }
  if (errorCode !== undefined && AMBIGUOUS_NETWORK_CODES.has(errorCode)) {
    return manualReview(
      `Network failure ${errorCode} may have happened after provider submission`,
    );
  }
  if (networkFailure) {
    return manualReview(
      "The network failed, but it is unknown whether provider submission completed",
    );
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return manualReview(
      `HTTP ${statusCode} does not prove that the provider rejected the generation`,
    );
  }
  if (retryableFlag === true) {
    return manualReview(
      "The error is transient, but submission safety was not established",
    );
  }

  return fail("The submission error is not classified as retryable");
}

export function isRetryable(context: RetryContext): boolean {
  return classifyRetry(context).retryable;
}

export const classifyRetryError = classifyRetry;
export const shouldRetry = isRetryable;

export function getRetryClassification(
  context: RetryContext,
): RetryDecision["classification"] {
  return classifyRetry(context).classification;
}

export function calculateBackoffMs(
  attempt: number,
  options: BackoffOptions = {},
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("attempt must be a positive integer");
  }
  const baseMs = options.baseMs ?? DEFAULT_RETRY_BASE_MS;
  const maxMs = options.maxMs ?? DEFAULT_RETRY_MAX_MS;
  const jitter = options.jitter ?? 0;
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new RangeError("baseMs must be a non-negative finite number");
  }
  if (!Number.isFinite(maxMs) || maxMs < 0) {
    throw new RangeError("maxMs must be a non-negative finite number");
  }
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new RangeError("jitter must be between 0 and 1");
  }

  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  if (jitter === 0 || exponential === 0) {
    return Math.round(exponential);
  }

  const random = options.random?.() ?? Math.random();
  if (!Number.isFinite(random) || random < 0 || random > 1) {
    throw new RangeError("random() must return a number between 0 and 1");
  }
  const factor = 1 + (random * 2 - 1) * jitter;
  return Math.round(Math.min(maxMs, Math.max(0, exponential * factor)));
}

export const exponentialBackoffMs = calculateBackoffMs;
export const getRetryDelayMs = calculateBackoffMs;
