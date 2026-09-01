import type {
  DirectorGraphPatch,
  DirectorModelCapabilities,
  DirectorProtocol,
  DirectorSource,
  RoutedDirectorCall,
} from "@super-canvas/director";

export const DIRECTOR_STAGES = [
  "understanding",
  "prompting",
] as const;

export type DirectorStage = (typeof DIRECTOR_STAGES)[number];

export interface DirectorPublicProfile {
  readonly id: string;
  readonly configured: boolean;
  readonly brainConnectionId?: string;
  readonly brainConnectionName?: string;
  readonly brainModelId?: string;
  readonly protocol?: DirectorProtocol;
  readonly reasoningEffort?: string;
  readonly researchConnectionId?: string;
  readonly connected: boolean;
  readonly capabilities?: DirectorModelCapabilities;
  readonly updatedAt?: string;
}

export interface DirectorPublicMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: "user" | "assistant" | "system";
  readonly kind: "message" | "clarification" | "proposal" | "status";
  readonly content: string;
  readonly createdAt: string;
}

export interface DirectorPublicProposal {
  readonly id: string;
  readonly sessionId: string;
  readonly canvasId: string;
  readonly version: number;
  readonly status:
    | "draft"
    | "awaiting_approval"
    | "approved"
    | "cancelled"
    | "expired"
    | "running"
    | "succeeded"
    | "failed";
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly calls: readonly RoutedDirectorCall[];
  readonly graphPatch?: DirectorGraphPatch;
  readonly sources: readonly DirectorSource[];
  readonly baseCanvasRevision: number;
  readonly knowledgeVersion: string;
  readonly catalogFingerprint: string;
  readonly expiresAt: string;
  readonly totalCnyMaximum?: number;
  readonly allCallsSelected: boolean;
  readonly workflowRunId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DirectorConversation {
  readonly session: {
    readonly id: string;
    readonly canvasId: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly messages: readonly DirectorPublicMessage[];
  readonly proposals: readonly DirectorPublicProposal[];
}

export type DirectorConversationSummary = DirectorConversation["session"];

export type DirectorTurnEvent =
  | {
      readonly type: "stage";
      readonly stage: DirectorStage;
      readonly message: string;
    }
  | { readonly type: "source"; readonly source: DirectorSource }
  | { readonly type: "message"; readonly message: DirectorPublicMessage }
  | { readonly type: "proposal"; readonly proposal: DirectorPublicProposal }
  | { readonly type: "error"; readonly message: string; readonly code?: string }
  | { readonly type: "done"; readonly sessionId: string };

export interface DirectorApproveResult {
  readonly proposal: DirectorPublicProposal;
  readonly canvas: {
    readonly id: string;
    readonly title: string;
    readonly graph: Record<string, unknown>;
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly run: unknown;
}
