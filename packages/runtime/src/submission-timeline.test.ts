import { expect, it } from "vitest";
import type { JsonObject } from "@super-canvas/db";
import { recordSubmissionPhase } from "./submission-timeline.js";

it("persists phase transitions once and bounds the trace", () => {
  const input: JsonObject = {};
  recordSubmissionPhase(input, "generating", "2026-09-27T00:00:00Z");
  recordSubmissionPhase(input, "generating", "2026-09-27T00:01:00Z");
  expect(input.submissionTimeline).toEqual([
    { phase: "generating", at: "2026-09-27T00:00:00Z" },
  ]);
  for (let i = 0; i < 40; i++)
    recordSubmissionPhase(input, i % 2 ? "downloading" : "receiving");
  expect(input.submissionTimeline).toHaveLength(32);
  expect(input.submissionPhase).toBe("downloading");
});
