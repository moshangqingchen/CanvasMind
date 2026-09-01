import { describe, expect, it } from "vitest";

import {
  DIRECTOR_DECISION_JSON_SCHEMA,
  DirectorDecisionSchema,
  ExchangeRateTableSchema,
  GenerationRequirementsSchema,
  parseDirectorDecision,
} from "../src/schemas.js";

describe("director schemas", () => {
  it("parses a fenced structured decision", () => {
    expect(
      parseDirectorDecision('```json\n{"type":"reply","message":"ok"}\n```'),
    ).toEqual({ type: "reply", message: "ok" });
  });

  it("extracts a structured decision when a compatible gateway adds prose", () => {
    expect(
      parseDirectorDecision(
        'Here is the result:\n{"type":"reply","message":"ok"}\n以上。',
      ),
    ).toEqual({ type: "reply", message: "ok" });
  });

  it("normalizes null placeholders required by strict structured outputs", () => {
    expect(
      parseDirectorDecision({
        type: "reply",
        message: "ok",
        questions: null,
        summary: null,
        assumptions: null,
        calls: null,
        releaseHold: null,
      }),
    ).toEqual({ type: "reply", message: "ok" });
    expect(DIRECTOR_DECISION_JSON_SCHEMA).not.toHaveProperty("oneOf");
    expect(new Set(DIRECTOR_DECISION_JSON_SCHEMA.required)).toEqual(
      new Set(Object.keys(DIRECTOR_DECISION_JSON_SCHEMA.properties)),
    );
  });

  it("strips known nullable envelope fields from reply and clarify outputs", () => {
    expect(
      parseDirectorDecision({
        type: "clarify",
        message: "请补充画面比例",
        questions: ["需要什么画面比例？"],
        summary: "",
        assumptions: [],
        calls: null,
        releaseHold: true,
      }),
    ).toEqual({
      type: "clarify",
      message: "请补充画面比例",
      questions: ["需要什么画面比例？"],
    });
  });

  it("rejects unknown and cyclic call dependencies", () => {
    const base = {
      type: "proposal",
      summary: "two calls",
      assumptions: [],
      calls: [
        {
          id: "a",
          label: "a",
          prompt: "a",
          requirements: { operation: "image.generate", count: 1 },
          dependsOn: ["b"],
        },
        {
          id: "b",
          label: "b",
          prompt: "b",
          requirements: { operation: "image.generate", count: 1 },
          dependsOn: ["a"],
        },
      ],
    };
    expect(DirectorDecisionSchema.safeParse(base).success).toBe(false);
    expect(
      DirectorDecisionSchema.safeParse({
        ...base,
        calls: [{ ...base.calls[0], dependsOn: ["missing"] }],
      }).success,
    ).toBe(false);
  });

  it("requires an image input for edit and image-to-video operations", () => {
    expect(
      GenerationRequirementsSchema.safeParse({
        operation: "image.edit",
        count: 1,
      }).success,
    ).toBe(false);
    expect(
      GenerationRequirementsSchema.safeParse({
        operation: "video.image-to-video",
        count: 1,
        inputKinds: ["image"],
        inputCounts: { image: 1 },
      }).success,
    ).toBe(true);
    expect(
      GenerationRequirementsSchema.safeParse({
        operation: "video.generate",
        count: 2,
      }).success,
    ).toBe(false);
  });

  it("validates rate windows and uppercase currency keys", () => {
    expect(
      ExchangeRateTableSchema.safeParse({
        base: "CNY",
        checkedAt: "2026-08-30T00:00:00.000Z",
        validUntil: "2026-08-29T00:00:00.000Z",
        rates: { usd: 7 },
      }).success,
    ).toBe(false);
  });
});
