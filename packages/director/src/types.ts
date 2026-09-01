import type { WorkflowEdge, WorkflowNode } from "@super-canvas/core";
import type {
  ModelDescriptor,
  ModelParameterValue,
  ProviderOperation,
  StructuredModelPricing,
} from "@super-canvas/providers";

export const DIRECTOR_PROTOCOLS = [
  "openai-responses",
  "openai-chat-completions",
  "anthropic-messages",
  "google-generate-content",
  "xai-responses",
  "generic-openai-compatible",
] as const;

export type DirectorProtocol = (typeof DIRECTOR_PROTOCOLS)[number];

export interface DirectorModelCapabilities {
  readonly text: boolean;
  readonly imageInput: boolean;
  readonly audioInput: boolean;
  readonly videoInput: boolean;
  readonly structuredOutput: boolean;
  readonly toolCalling: boolean;
  readonly nativeWebSearch: boolean;
  readonly reasoning: boolean;
  readonly contextWindow?: number;
  readonly probedAt?: string;
  readonly probeSource?: "live" | "provider-catalog" | "manual";
}

/** Safe to serialize to a browser. It never contains credentials. */
export interface DirectorConnectionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly supplier: string;
  readonly baseUrl: string;
  readonly protocol: DirectorProtocol;
  readonly model: string;
  readonly enabled: boolean;
  readonly reasoningEffort?: string;
  readonly capabilities: DirectorModelCapabilities;
  readonly allowLocalhost?: boolean;
}

/** Resolved only on the server immediately before an adapter call. */
export interface ResolvedDirectorConnection extends DirectorConnectionDescriptor {
  readonly apiKey: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** @deprecated Use DirectorConnectionDescriptor or ResolvedDirectorConnection. */
export type DirectorConnection = ResolvedDirectorConnection;

export type DirectorEvidenceLevel = "A" | "B" | "C" | "D";

export interface DirectorSource {
  readonly title: string;
  readonly url: string;
  readonly capturedAt: string;
  readonly evidence: DirectorEvidenceLevel;
  readonly snippet?: string;
  readonly observedScope?: string;
}

export interface DirectorAttachment {
  readonly kind: "image" | "audio" | "video";
  readonly url: string;
  readonly name?: string;
  readonly mimeType?: string;
}

export interface DirectorAdapterInput {
  readonly system: string;
  readonly messages: readonly {
    readonly role: "user" | "assistant";
    readonly content: string;
  }[];
  readonly attachments?: readonly DirectorAttachment[];
  readonly useNativeSearch?: boolean;
  readonly maxSearchCalls?: number;
  readonly responseJsonSchema?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface DirectorAdapterResult {
  readonly output: unknown;
  readonly text?: string;
  readonly sources: readonly DirectorSource[];
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
}

export interface DirectorModelAdapter {
  readonly protocol: DirectorProtocol;
  probeCapabilities?(
    connection: ResolvedDirectorConnection,
    signal?: AbortSignal,
  ): Promise<DirectorModelCapabilities>;
  complete(
    connection: ResolvedDirectorConnection,
    input: DirectorAdapterInput,
  ): Promise<DirectorAdapterResult>;
}

export interface GenerationRequirements {
  readonly operation: ProviderOperation;
  readonly count: number;
  readonly aspectRatio?: string;
  readonly resolution?: string;
  readonly durationSeconds?: number;
  readonly quality?: string;
  readonly inputKinds?: readonly ("image" | "video" | "audio")[];
  readonly inputCounts?: Readonly<
    Partial<Record<"image" | "video" | "audio", number>>
  >;
  readonly requiresTextRendering?: boolean;
  readonly requiresAudio?: boolean;
  readonly maximumInputTokens?: number;
  readonly maximumOutputTokens?: number;
  readonly maximumImageOutputTokens?: number;
}

export interface DirectorCallDraft {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly requirements: GenerationRequirements;
  readonly dependsOn?: readonly string[];
}

export type DirectorDecision =
  | { readonly type: "reply"; readonly message: string }
  | {
      readonly type: "clarify";
      readonly message: string;
      readonly questions: readonly string[];
    }
  | {
      readonly type: "proposal";
      readonly summary: string;
      readonly assumptions: readonly string[];
      readonly calls: readonly DirectorCallDraft[];
      readonly releaseHold?: boolean;
    };

export interface DirectorCatalogCandidate {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly provider: string;
  readonly supplier: string;
  readonly group?: string;
  readonly model: ModelDescriptor;
  readonly pricing?: StructuredModelPricing;
  readonly catalogCheckedAt?: string;
  readonly authoritative: boolean;
  readonly connectionActive?: boolean;
  readonly credentialUsable?: boolean;
}

export type DirectorPricingStatus =
  "known" | "unknown" | "stale" | "nonconvertible";

export interface DirectorQuoteBreakdown {
  readonly kind: StructuredModelPricing["kind"];
  readonly unitAmount?: number;
  readonly units?: number;
  readonly tierId?: string;
  readonly confidence: StructuredModelPricing["confidence"];
}

export interface DirectorQuote {
  readonly candidate: DirectorCatalogCandidate;
  readonly eligible: boolean;
  readonly exclusionReasons: readonly string[];
  readonly originalCurrency?: string;
  readonly originalMaximum?: number;
  readonly cnyMaximum?: number;
  readonly rateTimestamp?: string;
  readonly comparable: boolean;
  readonly pricingStatus: DirectorPricingStatus;
  readonly pricingSourceUrl?: string;
  readonly pricingCheckedAt?: string;
  readonly breakdown?: DirectorQuoteBreakdown;
}

export interface RoutedDirectorCall extends DirectorCallDraft {
  readonly selected?: DirectorQuote;
  readonly alternatives: readonly DirectorQuote[];
  readonly parameters: Readonly<Record<string, ModelParameterValue>>;
}

export interface DirectorCanvasNodeData extends Record<string, unknown> {
  readonly nodeType: "prompt" | "image-generation" | "video-generation";
  readonly label: string;
  readonly directorDraft: boolean;
  readonly directorCallId: string;
  readonly directorProposalId?: string;
}

export interface DirectorCanvasNode extends WorkflowNode<DirectorCanvasNodeData> {
  readonly type: "workflow";
  readonly position: { readonly x: number; readonly y: number };
  readonly style: { readonly width: number; readonly height: number };
  readonly data: DirectorCanvasNodeData;
}

export interface DirectorCanvasEdge extends WorkflowEdge {
  readonly type: "smoothstep";
}

export interface DirectorGraphPatch {
  readonly nodes: readonly DirectorCanvasNode[];
  readonly edges: readonly DirectorCanvasEdge[];
  readonly generationNodeIds: readonly string[];
  readonly touchedExistingNodeIds: readonly string[];
}

/** Each rate is CNY paid for one unit of the currency key. */
export interface ExchangeRateTable {
  readonly base: "CNY";
  readonly checkedAt: string;
  readonly validUntil: string;
  readonly rates: Readonly<Record<string, number>>;
  readonly source?: "ecb" | "manual" | (string & {});
}

export interface DirectorRoutingOptions {
  readonly now?: Date;
  readonly pricingMaxAgeMs?: number;
  readonly catalogMaxAgeMs?: number;
}
