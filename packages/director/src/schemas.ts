import { z } from "zod";

import { DIRECTOR_PROTOCOLS } from "./types.js";

const identifier = z.string().trim().min(1).max(128);
const isoDateTime = z.string().datetime({ offset: true });

export const DirectorProtocolSchema = z.enum(DIRECTOR_PROTOCOLS);

export const DirectorModelCapabilitiesSchema = z
  .object({
    text: z.boolean(),
    imageInput: z.boolean(),
    audioInput: z.boolean(),
    videoInput: z.boolean(),
    structuredOutput: z.boolean(),
    toolCalling: z.boolean(),
    nativeWebSearch: z.boolean(),
    reasoning: z.boolean(),
    contextWindow: z.number().int().positive().optional(),
    probedAt: isoDateTime.optional(),
    probeSource: z.enum(["live", "provider-catalog", "manual"]).optional(),
  })
  .strict();

export const DirectorConnectionDescriptorSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(200),
    provider: identifier,
    supplier: z.string().trim().min(1).max(200),
    baseUrl: z.string().url(),
    protocol: DirectorProtocolSchema,
    model: identifier,
    enabled: z.boolean(),
    reasoningEffort: z.string().trim().min(1).max(64).optional(),
    capabilities: DirectorModelCapabilitiesSchema,
    allowLocalhost: z.boolean().optional(),
  })
  .strict();

export const ExchangeRateTableSchema = z
  .object({
    base: z.literal("CNY"),
    checkedAt: isoDateTime,
    validUntil: isoDateTime,
    rates: z.record(z.number().finite().positive()),
    source: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.validUntil) <= Date.parse(value.checkedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "validUntil must be later than checkedAt",
      });
    }
    for (const currency of Object.keys(value.rates)) {
      if (!/^[A-Z]{3}$/u.test(currency)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rates", currency],
          message: "Currency keys must be uppercase ISO 4217 codes",
        });
      }
    }
  });

const InputCountsSchema = z
  .object({
    image: z.number().int().nonnegative().optional(),
    video: z.number().int().nonnegative().optional(),
    audio: z.number().int().nonnegative().optional(),
  })
  .strict();

export const GenerationRequirementsSchema = z
  .object({
    operation: z.enum([
      "image.generate",
      "image.edit",
      "video.generate",
      "video.image-to-video",
    ]),
    count: z.number().int().min(1).max(20),
    aspectRatio: z.string().trim().min(1).max(32).optional(),
    resolution: z.string().trim().min(1).max(64).optional(),
    durationSeconds: z.number().positive().max(300).optional(),
    quality: z.string().trim().min(1).max(64).optional(),
    inputKinds: z
      .array(z.enum(["image", "video", "audio"]))
      .max(12)
      .transform((kinds) => [...new Set(kinds)])
      .optional(),
    inputCounts: InputCountsSchema.optional(),
    requiresTextRendering: z.boolean().optional(),
    requiresAudio: z.boolean().optional(),
    maximumInputTokens: z.number().finite().nonnegative().optional(),
    maximumOutputTokens: z.number().finite().nonnegative().optional(),
    maximumImageOutputTokens: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const inputKinds = new Set(value.inputKinds ?? []);
    for (const [kind, count] of Object.entries(value.inputCounts ?? {})) {
      if (count !== undefined && count > 0 && !inputKinds.has(kind as never)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputCounts", kind],
          message: `${kind} must also be present in inputKinds`,
        });
      }
    }
    if (
      (value.operation === "image.edit" ||
        value.operation === "video.image-to-video") &&
      !inputKinds.has("image")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputKinds"],
        message: `${value.operation} requires image input`,
      });
    }
    if (value.operation.startsWith("video.") && value.count !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["count"],
        message: "Each video call must produce exactly one clip",
      });
    }
  });

export const DirectorCallDraftSchema = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(32_000),
    requirements: GenerationRequirementsSchema,
    dependsOn: z
      .array(identifier)
      .max(20)
      .transform((ids) => [...new Set(ids)])
      .optional(),
  })
  .strict();

const ReplySchema = z
  .object({
    type: z.literal("reply"),
    message: z.string().trim().min(1).max(32_000),
  })
  .strict();

const ClarifySchema = z
  .object({
    type: z.literal("clarify"),
    message: z.string().trim().min(1).max(8_000),
    questions: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
  })
  .strict();

const ProposalSchema = z
  .object({
    type: z.literal("proposal"),
    summary: z.string().trim().min(1).max(8_000),
    assumptions: z.array(z.string().trim().min(1).max(1_000)).max(20),
    calls: z.array(DirectorCallDraftSchema).min(1).max(20),
    releaseHold: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, call] of value.calls.entries()) {
      if (ids.has(call.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calls", index, "id"],
          message: `Duplicate call id: ${call.id}`,
        });
      }
      ids.add(call.id);
    }

    const adjacency = new Map(
      value.calls.map((call) => [call.id, call.dependsOn ?? []] as const),
    );
    for (const [index, call] of value.calls.entries()) {
      for (const dependency of call.dependsOn ?? []) {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["calls", index, "dependsOn"],
            message: `Unknown dependency: ${dependency}`,
          });
        } else if (dependency === call.id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["calls", index, "dependsOn"],
            message: "A call cannot depend on itself",
          });
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const cyclic = (adjacency.get(id) ?? []).some((dependency) =>
        adjacency.has(dependency) ? visit(dependency) : false,
      );
      visiting.delete(id);
      visited.add(id);
      return cyclic;
    };
    if (value.calls.some((call) => visit(call.id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calls"],
        message: "Call dependencies must be acyclic",
      });
    }
    if (
      value.calls.reduce((total, call) => total + call.requirements.count, 0) >
      100
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calls"],
        message: "A proposal may generate at most 100 media outputs",
      });
    }
  });

export const DirectorDecisionSchema = z.union([
  ReplySchema,
  ClarifySchema,
  ProposalSchema,
]);

type JsonSchema = Readonly<Record<string, unknown>>;
const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});

const inputCountsJsonSchema = {
  type: "object",
  properties: {
    image: nullable({ type: "integer", minimum: 0 }),
    video: nullable({ type: "integer", minimum: 0 }),
    audio: nullable({ type: "integer", minimum: 0 }),
  },
  required: ["image", "video", "audio"],
  additionalProperties: false,
} as const;

const requirementsJsonSchema = {
  type: "object",
  properties: {
    operation: {
      type: "string",
      enum: [
        "image.generate",
        "image.edit",
        "video.generate",
        "video.image-to-video",
      ],
    },
    count: { type: "integer", minimum: 1, maximum: 20 },
    aspectRatio: nullable({ type: "string" }),
    resolution: nullable({ type: "string" }),
    durationSeconds: nullable({
      type: "number",
      exclusiveMinimum: 0,
      maximum: 300,
    }),
    quality: nullable({ type: "string" }),
    inputKinds: nullable({
      type: "array",
      items: { type: "string", enum: ["image", "video", "audio"] },
    }),
    inputCounts: nullable(inputCountsJsonSchema),
    requiresTextRendering: nullable({ type: "boolean" }),
    requiresAudio: nullable({ type: "boolean" }),
    maximumInputTokens: nullable({ type: "number", minimum: 0 }),
    maximumOutputTokens: nullable({ type: "number", minimum: 0 }),
    maximumImageOutputTokens: nullable({ type: "number", minimum: 0 }),
  },
  required: [
    "operation",
    "count",
    "aspectRatio",
    "resolution",
    "durationSeconds",
    "quality",
    "inputKinds",
    "inputCounts",
    "requiresTextRendering",
    "requiresAudio",
    "maximumInputTokens",
    "maximumOutputTokens",
    "maximumImageOutputTokens",
  ],
  additionalProperties: false,
} as const;

const callJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    prompt: { type: "string" },
    dependsOn: nullable({ type: "array", items: { type: "string" } }),
    requirements: requirementsJsonSchema,
  },
  required: ["id", "label", "prompt", "dependsOn", "requirements"],
  additionalProperties: false,
} as const;

/**
 * Strict-output-compatible shape. Optional decision fields are required and
 * nullable because OpenAI-compatible strict schemas require every property to
 * be listed in `required`. parseDirectorDecision removes only null values.
 */
export const DIRECTOR_DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["reply", "clarify", "proposal"] },
    message: nullable({ type: "string" }),
    questions: nullable({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5,
    }),
    summary: nullable({ type: "string" }),
    assumptions: nullable({ type: "array", items: { type: "string" } }),
    calls: nullable({
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: callJsonSchema,
    }),
    releaseHold: nullable({ type: "boolean" }),
  },
  required: [
    "type",
    "message",
    "questions",
    "summary",
    "assumptions",
    "calls",
    "releaseHold",
  ],
  additionalProperties: false,
} as const;

const DIRECTOR_DECISION_ENVELOPE_KEYS = new Set([
  "type",
  "message",
  "questions",
  "summary",
  "assumptions",
  "calls",
  "releaseHold",
]);

/**
 * Several compatible gateways return the strict-output envelope with every
 * nullable field populated (for example `summary: ""` or
 * `releaseHold: true`) even for a reply/clarification. Pick only the fields
 * belonging to the declared decision type, while keeping unknown fields
 * invalid so accidental protocol drift is still detected.
 */
function normalizeDecisionEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (type !== "reply" && type !== "clarify" && type !== "proposal") {
    return value;
  }
  if (Object.keys(record).some((key) => !DIRECTOR_DECISION_ENVELOPE_KEYS.has(key))) {
    return value;
  }
  const fieldsByType = {
    reply: ["type", "message"],
    clarify: ["type", "message", "questions"],
    proposal: ["type", "summary", "assumptions", "calls", "releaseHold"],
  } as const;
  return Object.fromEntries(
    fieldsByType[type].flatMap((key) =>
      Object.prototype.hasOwnProperty.call(record, key)
        ? [[key, record[key]]]
        : [],
    ),
  );
}

export function parseDirectorDecision(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
    const candidate = fenced?.[1]?.trim() ?? trimmed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      // A few compatible gateways prepend a short sentence despite the JSON
      // instruction. Extract one balanced object before applying the schema.
      let start = -1;
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let index = 0; index < candidate.length; index += 1) {
        const character = candidate[index]!;
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
          continue;
        }
        if (character === '"') {
          quoted = true;
          continue;
        }
        if (character === "{" && start < 0) {
          start = index;
          depth = 1;
          continue;
        }
        if (start >= 0 && character === "{") depth += 1;
        if (start >= 0 && character === "}") {
          depth -= 1;
          if (depth === 0) {
            parsed = JSON.parse(candidate.slice(start, index + 1));
            break;
          }
        }
      }
      if (start < 0 || depth !== 0) throw new Error("导演决策 JSON 无法解析");
    }
  }
  const removeNulls = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(removeNulls);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item)
        .filter(([, child]) => child !== null)
        .map(([key, child]) => [key, removeNulls(child)]),
    );
  };
  return DirectorDecisionSchema.parse(
    removeNulls(normalizeDecisionEnvelope(parsed)),
  );
}
