import { z } from "zod";
import {
  DirectorCallDraftSchema,
  type RoutedDirectorCall,
  type DirectorGraphPatch,
} from "@super-canvas/director";

const id = z.string().trim().min(1).max(256);
const text = z.string().trim().min(1).max(32000);
export const AgentShotSchema = z
  .object({
    id,
    start: z.number().min(0),
    end: z.number().positive(),
    camera: z.string().max(2000),
    action: text,
    dialogue: z.string().max(4000).default(""),
    sound: z.string().max(2000).default(""),
    prompt: text,
    characterIds: z.array(id).max(20).default([]),
    assetIds: z.array(id).max(16).default([]),
  })
  .strict();
export const AgentArtifactSchema = z
  .object({
    kind: z.enum(["text", "storyboard"]),
    title: id,
    content: z.string().max(64000).default(""),
    totalDuration: z.number().positive().optional(),
    characters: z
      .array(z.object({ id, description: text }).strict())
      .max(30)
      .default([]),
    shots: z.array(AgentShotSchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "text" && !value.content.trim())
      ctx.addIssue({ code: "custom", message: "文字成果不能为空" });
    if (value.kind !== "storyboard") return;
    const chars = new Set(value.characters.map((c) => c.id));
    const seen = new Set<string>();
    let end = 0;
    if (!value.shots.length || !value.totalDuration)
      ctx.addIssue({ code: "custom", message: "分镜需要镜头和总时长" });
    for (const shot of value.shots) {
      if (
        seen.has(shot.id) ||
        shot.start < end ||
        shot.end <= shot.start ||
        shot.characterIds.some((c) => !chars.has(c))
      )
        ctx.addIssue({
          code: "custom",
          message: "镜头 ID、时间顺序或角色引用无效",
        });
      seen.add(shot.id);
      end = shot.end;
    }
    if (value.totalDuration && Math.abs(end - value.totalDuration) > 0.01)
      ctx.addIssue({ code: "custom", message: "镜头结束时间必须与总时长一致" });
  });
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
export const AgentCallSchema = DirectorCallDraftSchema.extend({
  sourceAssetIds: z.array(id).max(16).default([]),
  preferredConnectionId: id.optional(),
  preferredModelId: id.optional(),
  recommendation: z.string().max(2000).default(""),
});
export const AgentProposalSchema = z
  .object({
    type: z.literal("proposal"),
    summary: text,
    assumptions: z.array(text).max(20).default([]),
    calls: z.array(AgentCallSchema).max(20).default([]),
    texts: z
      .array(
        z
          .object({ id, title: id, content: text, targetNodeId: id.optional() })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = new Set(v.calls.map((c) => c.id));
    if (!v.calls.length && !v.texts.length)
      ctx.addIssue({ code: "custom", message: "方案没有成果或节点" });
    if (
      ids.size !== v.calls.length ||
      new Set(v.texts.map((t) => t.id)).size !== v.texts.length
    )
      ctx.addIssue({ code: "custom", message: "步骤 ID 不能重复" });
    if (v.calls.reduce((n, c) => n + c.requirements.count, 0) > 100)
      ctx.addIssue({
        code: "custom",
        message: "一个方案最多生成 100 个成果，请分批规划",
      });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (id: string): boolean => {
      if (visiting.has(id) || !ids.has(id)) return false;
      if (visited.has(id)) return true;
      visiting.add(id);
      for (const dep of v.calls.find((c) => c.id === id)?.dependsOn ?? [])
        if (!walk(dep)) return false;
      visiting.delete(id);
      visited.add(id);
      return true;
    };
    if (v.calls.some((c) => !walk(c.id)))
      ctx.addIssue({ code: "custom", message: "步骤依赖不存在或包含循环" });
    for (const c of v.calls)
      if (
        ["image.edit", "video.image-to-video"].includes(
          c.requirements.operation,
        ) &&
        !c.sourceAssetIds.length &&
        !c.dependsOn?.length
      )
        ctx.addIssue({
          code: "custom",
          message: "图片编辑或图生视频必须连接原图或前序图像步骤",
        });
  });
export type AgentProposal = z.infer<typeof AgentProposalSchema>;
const AgentDecisionCoreSchema = z.union([
  z.object({ type: z.literal("reply"), message: text }).strict(),
  z
    .object({
      type: z.literal("clarify"),
      message: text,
      questions: z
        .array(
          z
            .object({
              id,
              question: text,
              options: z.array(id).max(6).default([]),
            })
            .strict(),
        )
        .min(1)
        .max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal("artifact"),
      message: text,
      artifact: AgentArtifactSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("tool"),
      tool: z.enum([
        "read_canvas",
        "list_models",
        "inspect_assets",
        "read_results",
      ]),
      message: text,
      assetIds: z.array(id).max(16).default([]),
      runId: id.optional(),
    })
    .strict(),
  AgentProposalSchema,
]);
export const AgentTaskMemorySchema = z
  .object({
    goal: text,
    requirements: z.array(text).max(80),
    completedSteps: z.array(text).max(80),
    openQuestions: z.array(text).max(20),
  })
  .strict();
export const AgentDecisionSchema = z
  .preprocess(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      const { taskMemory, ...decision } = value as Record<string, unknown>;
      return { decision, taskMemory };
    },
    z
      .object({
        decision: AgentDecisionCoreSchema,
        taskMemory: AgentTaskMemorySchema.optional(),
      })
      .strict(),
  )
  .transform(({ decision, taskMemory }) => ({
    ...decision,
    ...(taskMemory ? { taskMemory } : {}),
  }));
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
// The authoritative gate is AgentDecisionSchema on the server. This portable
// envelope also works on gateways that do not implement JSON Schema unions.
export const AGENT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    decision: {
      type: "string",
      description:
        "A JSON-encoded agent decision following the system instructions, including all required fields.",
    },
  },
  required: ["decision"],
  additionalProperties: false,
} as const;
export const AgentTurnSchema = z
  .object({
    canvasId: id,
    sessionId: id,
    requestId: id,
    connectionId: id,
    modelId: id,
    message: text,
    attachmentAssetIds: z.array(id).max(16).default([]),
    selectedNodeIds: z.array(id).max(100).default([]),
    reasoningEffort: z.string().max(20).optional(),
    skipVisualAnalysis: z.boolean().optional(),
    helper: z
      .object({ connectionId: id, modelId: id, assetIds: z.array(id).max(16) })
      .strict()
      .optional(),
  })
  .strict();
export type AgentTurnInput = z.infer<typeof AgentTurnSchema>;
export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}
export interface AgentPreflight {
  id: string;
  hash: string;
  expiresAt: string;
  canvasRevision: number;
  nodeIds: string[];
  summary: string;
  unknownPrice: boolean;
  totalCnyMaximum?: number;
}
export interface AgentPlan {
  id: string;
  sessionId: string;
  canvasId: string;
  version: number;
  status: string;
  summary: string;
  baseCanvasRevision: number;
  proposal: AgentProposal;
  calls: RoutedDirectorCall[];
  patch?: DirectorGraphPatch;
  changes?: Array<{ nodeId: string; before: string; after: string }>;
  preflight?: AgentPreflight;
  workflowRunId?: string;
  results?: Array<{
    nodeId: string;
    status: string;
    assetIds: string[];
    error?: string;
  }>;
  error?: string;
}
export interface AgentSession {
  id: string;
  canvasId: string;
  title: string;
  messages: AgentMessage[];
  plans: AgentPlan[];
}
export type AgentEvent =
  | { type: "stage"; message: string }
  | { type: "session"; session: AgentSession }
  | { type: "error"; message: string }
  | { type: "done" };
