import { z } from "zod";

import {
  BUILT_IN_NODE_TYPES,
  GRAPH_VALIDATION_ISSUE_CODES,
  NODE_RUN_STATUSES,
  PORT_KINDS,
  PROMPT_ASSET_ROLES,
  PROVIDER_CAPABILITIES,
  RETRY_ACTIONS,
  RETRY_CLASSIFICATIONS,
  RETRY_PHASES,
  RUN_SCOPES,
  SUBMISSION_OUTCOMES,
} from "./types.js";

const identifier = z.string().trim().min(1);

export const PortKindSchema = z.enum(PORT_KINDS);
export const RunScopeSchema = z.enum(RUN_SCOPES);
export const BuiltInNodeTypeSchema = z.enum(BUILT_IN_NODE_TYPES);
export const NodeTypeSchema = identifier;
export const PromptAssetRoleSchema = z.enum(PROMPT_ASSET_ROLES);
export const NodeRunStatusSchema = z.enum(NODE_RUN_STATUSES);
export const RetryPhaseSchema = z.enum(RETRY_PHASES);
export const SubmissionOutcomeSchema = z.enum(SUBMISSION_OUTCOMES);
export const ProviderCapabilitySchema = z.enum(PROVIDER_CAPABILITIES);
export const GraphValidationIssueCodeSchema = z.enum(
  GRAPH_VALIDATION_ISSUE_CODES,
);
export const RetryClassificationSchema = z.enum(RETRY_CLASSIFICATIONS);
export const RetryActionSchema = z.enum(RETRY_ACTIONS);

export const TextPromptPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strict();

export const AssetPromptPartSchema = z
  .object({
    type: z.literal("asset"),
    assetId: identifier,
    role: PromptAssetRoleSchema,
  })
  .strict();

export const PromptPartSchema = z.discriminatedUnion("type", [
  TextPromptPartSchema,
  AssetPromptPartSchema,
]);

export const PromptPartsSchema = z.array(PromptPartSchema);

export const PointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const PortDefinitionSchema = z
  .object({
    id: identifier,
    kind: PortKindSchema,
    label: z.string().optional(),
    required: z.boolean().optional(),
    multiple: z.boolean().optional(),
    maxConnections: z.number().int().positive().optional(),
  })
  .strict();

export const PortMapValueSchema = PortDefinitionSchema.omit({
  id: true,
}).extend({
  id: identifier.optional(),
});

export const PortCollectionSchema = z.union([
  z.array(PortDefinitionSchema),
  z.record(PortMapValueSchema),
]);

export const WorkflowNodeSchema = z
  .object({
    id: identifier,
    type: NodeTypeSchema,
    kind: NodeTypeSchema.optional(),
    position: PointSchema.optional(),
    data: z.record(z.unknown()).optional(),
    inputs: PortCollectionSchema.optional(),
    outputs: PortCollectionSchema.optional(),
    inputPorts: PortCollectionSchema.optional(),
    outputPorts: PortCollectionSchema.optional(),
  })
  .passthrough();

export const WorkflowEdgeSchema = z
  .object({
    id: identifier,
    source: identifier,
    target: identifier,
    sourcePort: identifier.nullable().optional(),
    targetPort: identifier.nullable().optional(),
    sourceHandle: identifier.nullable().optional(),
    targetHandle: identifier.nullable().optional(),
    sourceOutput: identifier.nullable().optional(),
    targetInput: identifier.nullable().optional(),
  })
  .passthrough();

export const WorkflowGraphSchema = z
  .object({
    nodes: z.array(WorkflowNodeSchema),
    edges: z.array(WorkflowEdgeSchema),
  })
  .strict();

export const GraphNodeSchema = WorkflowNodeSchema;
export const GraphEdgeSchema = WorkflowEdgeSchema;
export const GraphSchema = WorkflowGraphSchema;
export const NodePortSchema = PortDefinitionSchema;
export const NodeSchema = WorkflowNodeSchema;
export const EdgeSchema = WorkflowEdgeSchema;
export const PortSchema = PortDefinitionSchema;

export const GraphValidationOptionsSchema = z
  .object({
    checkPorts: z.boolean().optional(),
    checkRequiredInputs: z.boolean().optional(),
  })
  .strict();

export const GraphValidationIssueSchema = z
  .object({
    code: GraphValidationIssueCodeSchema,
    message: z.string().min(1),
    nodeId: identifier.optional(),
    edgeId: identifier.optional(),
    portId: identifier.optional(),
    path: z.array(identifier).optional(),
  })
  .strict();

export const GraphValidationResultSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(GraphValidationIssueSchema),
    cycles: z.array(z.array(identifier)),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.valid !== (value.errors.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valid"],
        message: "valid must match whether errors is empty",
      });
    }
  });

export const RunSubgraphSchema = WorkflowGraphSchema.extend({
  nodeIds: z.array(identifier),
  edgeIds: z.array(identifier),
});

export const PromptAssetDescriptorSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).optional(),
    url: z.string().url().optional(),
  })
  .strict();

export const NodeRunErrorSchema = z
  .object({
    code: z.string().optional(),
    message: z.string().min(1),
    retryable: z.boolean().optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    details: z.unknown().optional(),
  })
  .strict();

const isoDateTime = z.string().datetime({ offset: true });

export const NodeRunRecordSchema = z
  .object({
    id: identifier,
    workflowRunId: identifier,
    nodeId: identifier,
    status: NodeRunStatusSchema,
    attempt: z.number().int().nonnegative(),
    providerTaskId: identifier.nullable().optional(),
    inputAssetIds: z.array(identifier).optional(),
    outputAssetIds: z.array(identifier).optional(),
    error: NodeRunErrorSchema.nullable().optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
    startedAt: isoDateTime.nullable().optional(),
    finishedAt: isoDateTime.nullable().optional(),
  })
  .strict();

export const NodeRunSchema = NodeRunRecordSchema;

export const RetryContextSchema = z
  .object({
    phase: RetryPhaseSchema,
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive().optional(),
    error: z.unknown().optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    providerTaskId: identifier.nullable().optional(),
    submissionOutcome: SubmissionOutcomeSchema.optional(),
  })
  .strict();

export const RetryDecisionSchema = z
  .object({
    classification: RetryClassificationSchema,
    action: RetryActionSchema,
    retryable: z.boolean(),
    canResubmit: z.boolean(),
    reason: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.canResubmit && !value.retryable) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canResubmit"],
        message: "A non-retryable decision cannot permit resubmission",
      });
    }
  });

export const BackoffOptionsSchema = z
  .object({
    baseMs: z.number().finite().nonnegative().optional(),
    maxMs: z.number().finite().nonnegative().optional(),
    jitter: z.number().min(0).max(1).optional(),
    random: z.function().returns(z.number().min(0).max(1)).optional(),
  })
  .strict();

export const ModelDescriptorSchema = z
  .object({
    id: identifier,
    name: z.string().min(1),
    provider: identifier,
    capabilities: z.array(ProviderCapabilitySchema).min(1),
    inputKinds: z.array(PortKindSchema).optional(),
    outputKinds: z.array(PortKindSchema).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const ValidationIssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number().int()])).optional(),
    code: identifier,
    message: z.string().min(1),
  })
  .strict();

export const ValidationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(ValidationIssueSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.valid && value.issues.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issues"],
        message: "A valid result cannot contain validation issues",
      });
    }
  });

export const NormalizedAssetInputSchema = z
  .object({
    assetId: identifier,
    kind: z.enum(["image", "video"]),
    role: PromptAssetRoleSchema.optional(),
    mimeType: z.string().min(1).optional(),
    url: z.string().url().optional(),
  })
  .strict();

export const NormalizedRequestSchema = z
  .object({
    provider: identifier,
    model: identifier,
    capability: ProviderCapabilitySchema,
    prompt: PromptPartsSchema,
    assets: z.array(NormalizedAssetInputSchema),
    parameters: z.record(z.unknown()),
    idempotencyKey: identifier,
  })
  .strict();

export const ProviderTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const ProviderTaskSchema = z
  .object({
    id: identifier,
    status: ProviderTaskStatusSchema,
    raw: z.unknown().optional(),
  })
  .strict();

export const RemoteArtifactSchema = z
  .object({
    kind: z.enum(["image", "video"]),
    url: z.string().url(),
    mimeType: z.string().min(1).optional(),
    filename: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const NormalizedTaskStateSchema = z
  .object({
    status: ProviderTaskStatusSchema,
    progress: z.number().min(0).max(1).optional(),
    outputs: z.array(RemoteArtifactSchema).optional(),
    error: NodeRunErrorSchema.optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const CreateRunRequestSchema = z
  .object({
    canvasId: identifier,
    clientRequestId: identifier,
    scope: RunScopeSchema,
    nodeId: identifier.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope !== "all" && value.nodeId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeId"],
        message: `nodeId is required for ${value.scope} scope`,
      });
    }
  });
