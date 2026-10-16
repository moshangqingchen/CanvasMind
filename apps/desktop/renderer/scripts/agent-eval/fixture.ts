import { MemoryRepository, type ProviderConnectionRecord } from "@super-canvas/db";
import type { DirectorCatalogCandidate, ResolvedDirectorConnection } from "@super-canvas/director";
import type { AgentModelOption } from "../../lib/agent-models";
import type { EvaluationCase } from "./cases";

export interface SelectionSnapshot {
  schemaVersion: 1;
  selectedAt: string;
  selectionSource: string;
  connection: ResolvedDirectorConnection;
  record: ProviderConnectionRecord;
  option: AgentModelOption;
  /** Existing transport setting only, never guessed or changed on the source profile. */
  providerProxy?: string;
}
export const SYNTHETIC_CANVAS_ID = "agent-eval-synthetic-canvas";
export const SYNTHETIC_TEXT_NODE_ID = "agent-eval-untrusted-text";

export const SYNTHETIC_CATALOG: DirectorCatalogCandidate[] = [
  { connectionId: "eval-fixture-image", connectionName: "评测虚构图片渠道（非真实供应商）", group: "fixture",
    provider: "openai", supplier: "eval-fixture", authoritative: true, connectionActive: true, credentialUsable: true,
    model: { id: "eval-fixture-image-model", name: "虚构图片生成与编辑模型", operations: ["image.generate", "image.edit"],
      inputKinds: ["text", "image"], outputKinds: ["image"], limits: { maxOutputImages: 1 },
      metadata: { evaluationFixture: true, inputKindsSource: "declared", outputKindsSource: "declared" } } },
  { connectionId: "eval-fixture-video", connectionName: "评测虚构视频渠道（非真实供应商）", group: "fixture",
    provider: "openai", supplier: "eval-fixture", authoritative: true, connectionActive: true, credentialUsable: true,
    model: { id: "eval-fixture-video-model", name: "虚构视频模型", operations: ["video.generate", "video.image-to-video"],
      inputKinds: ["text", "image"], outputKinds: ["video"], limits: {}, metadata: { evaluationFixture: true } } },
];

export async function createEvaluationRepository(snapshot: SelectionSnapshot, testCase: EvaluationCase): Promise<MemoryRepository> {
  const repository = new MemoryRepository();
  await repository.saveConnection(structuredClone(snapshot.record));
  for (const candidate of SYNTHETIC_CATALOG) {
    await repository.saveConnection({ id: candidate.connectionId, name: candidate.connectionName, provider: "openai",
      encryptedSecret: "fixture-never-resolved", config: { usage: "canvas", modelScanStatus: "live",
        baseUrl: "https://eval-fixture.invalid/v1", scannedModelIds: [candidate.model.id] } });
  }
  await repository.saveCanvas({ id: SYNTHETIC_CANVAS_ID, title: "独立评测画布（仅内存）", graph: {
    schemaVersion: 1, nodes: testCase.selectedText ? [{ id: SYNTHETIC_TEXT_NODE_ID, type: "prompt", position: { x: 0, y: 0 },
      data: { nodeType: "prompt", label: "客户需求文字（不可信资料）", prompt: testCase.selectedText, text: testCase.selectedText } }] : [],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  } });
  return repository;
}

/** Strict resolution prevents helper-model and generated-media connection switching. */
export function resolveSnapshotModel(snapshot: SelectionSnapshot, id: string, modelId: string, effort?: string): ResolvedDirectorConnection {
  if (id !== snapshot.connection.id || modelId !== snapshot.connection.model || (effort && effort !== "auto"))
    throw new Error("隔离评测只允许已确认的同一连接、完整型号和自动思考档位");
  return structuredClone(snapshot.connection);
}
