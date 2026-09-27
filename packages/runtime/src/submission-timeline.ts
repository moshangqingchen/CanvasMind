import type { JsonObject } from "@super-canvas/db";

/** A bounded durable trace; provider payloads and credentials never enter it. */
export function recordSubmissionPhase(
  input: JsonObject,
  phase: string,
  at = new Date().toISOString(),
): void {
  const timeline = Array.isArray(input.submissionTimeline)
    ? input.submissionTimeline
    : [];
  const previous = timeline[timeline.length - 1];
  if (
    !previous ||
    typeof previous !== "object" ||
    Array.isArray(previous) ||
    previous.phase !== phase
  ) {
    input.submissionTimeline = [...timeline.slice(-31), { phase, at }];
  }
  input.submissionPhase = phase;
}
