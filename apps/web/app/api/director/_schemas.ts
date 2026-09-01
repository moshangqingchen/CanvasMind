import {
  DirectorModelCapabilitiesSchema,
  DirectorProtocolSchema,
} from "@super-canvas/director";
import { z } from "zod";

import { RouteIdentifierSchema } from "../../../lib/api-validation";

const MessageSchema = z.string().trim().min(1).max(32_000);
const FiniteCoordinateSchema = z
  .number()
  .finite()
  .min(-1_000_000)
  .max(1_000_000);

export const DirectorProfilePatchSchema = z
  .object({
    brainConnectionId: RouteIdentifierSchema,
    brainModelId: RouteIdentifierSchema,
    protocol: DirectorProtocolSchema.optional(),
    capabilities: DirectorModelCapabilitiesSchema.optional(),
    researchConnectionId: RouteIdentifierSchema.nullable().optional(),
    reasoningEffort: z.string().trim().min(1).max(64).nullable().optional(),
    manualRates: z
      .record(
        z.string().regex(/^[A-Z]{3}$/u, "汇率币种必须是三位大写代码"),
        z.number().finite().positive().max(1_000_000),
      )
      .superRefine((rates, context) => {
        if (Object.keys(rates).length > 50) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "手工汇率最多包含 50 个币种",
          });
        }
      })
      .optional(),
  })
  .strict();

export const DirectorSessionsQuerySchema = z
  .object({
    canvasId: RouteIdentifierSchema,
    sessionId: RouteIdentifierSchema.optional(),
  })
  .strict();

export const DirectorSessionCreateSchema = z
  .object({ canvasId: RouteIdentifierSchema })
  .strict();

export const DirectorTurnRequestSchema = z
  .object({
    canvasId: RouteIdentifierSchema,
    sessionId: RouteIdentifierSchema.optional(),
    message: MessageSchema,
    attachmentAssetIds: z
      .array(RouteIdentifierSchema)
      .max(3, "单次最多附带 3 个素材")
      .refine((ids) => new Set(ids).size === ids.length, "素材不能重复")
      .optional(),
    context: z
      .object({
        label: z.string().trim().min(1).max(240),
        prompt: z.string().trim().min(1).max(16_000).optional(),
        assetKind: z.enum(["image", "video", "audio"]).optional(),
      })
      .strict()
      .optional(),
    viewport: z
      .object({
        x: FiniteCoordinateSchema,
        y: FiniteCoordinateSchema,
        zoom: z.number().finite().positive().min(0.01).max(8).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const DirectorProposalRevisionSchema = z
  .object({
    version: z.number().int().positive().safe(),
    callId: RouteIdentifierSchema,
    connectionId: RouteIdentifierSchema,
    modelId: RouteIdentifierSchema,
  })
  .strict();

export const DirectorProposalApprovalSchema = z
  .object({
    version: z.number().int().positive().safe(),
    canvasRevision: z.number().int().nonnegative().safe(),
  })
  .strict();

export const DirectorProposalCancellationSchema = z
  .object({
    version: z.number().int().positive().safe(),
  })
  .strict();
