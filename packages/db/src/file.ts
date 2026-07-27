import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AssetRecord,
  CanvasRecord,
  NodeRunRecord,
  NodeRunUpdateOptions,
  ProviderConnectionRecord,
  WebhookEventRecord,
  WorkflowRunRecord,
  WorkflowStatus,
} from "./types.js";
import { MemoryRepository, type MemoryRepositorySnapshot } from "./memory.js";

function readSnapshot(path: string): MemoryRepositorySnapshot | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<MemoryRepositorySnapshot>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.canvases) ||
      !Array.isArray(parsed.revisions) ||
      !Array.isArray(parsed.assets) ||
      !Array.isArray(parsed.connections) ||
      !Array.isArray(parsed.runs) ||
      !Array.isArray(parsed.nodeRuns) ||
      !Array.isArray(parsed.webhookKeys)
    ) {
      throw new Error(`Unsupported local database format: ${path}`);
    }
    return parsed as MemoryRepositorySnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export class FileRepository extends MemoryRepository {
  private writeQueue = Promise.resolve();
  private writeSequence = 0;

  constructor(
    private readonly path: string,
    private readonly replaceFile: typeof rename = rename,
  ) {
    super(readSnapshot(path));
  }

  private async replaceSnapshot(
    temporaryPath: string,
    contents: string,
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporaryPath, contents, "utf8");

    // Windows can briefly hold the destination while another reader closes it.
    // Retry the atomic replacement instead of poisoning the save queue.
    const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY", "ETXTBSY"]);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.replaceFile(temporaryPath, this.path);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!retryableCodes.has(code ?? "") || attempt >= 7) throw error;
        await delay(Math.min(25 * 2 ** attempt, 500));
      }
    }
  }

  private async persist(): Promise<void> {
    const contents = JSON.stringify(this.exportSnapshot());
    const temporaryPath = `${this.path}.${process.pid}.${++this.writeSequence}.tmp`;
    const operation = this.writeQueue
      .catch(() => undefined)
      .then(() => this.replaceSnapshot(temporaryPath, contents));
    this.writeQueue = operation;
    await this.writeQueue;
  }

  override async ensureDefaultCanvas(): Promise<CanvasRecord> {
    const existing = await this.listCanvases();
    const result = await super.ensureDefaultCanvas();
    if (existing.length === 0) await this.persist();
    return result;
  }

  override async saveCanvas(
    input: Parameters<MemoryRepository["saveCanvas"]>[0],
  ): Promise<CanvasRecord> {
    const result = await super.saveCanvas(input);
    await this.persist();
    return result;
  }

  override async saveAsset(
    input: Omit<AssetRecord, "createdAt" | "deleted"> & {
      createdAt?: string;
      deleted?: boolean;
    },
  ): Promise<AssetRecord> {
    const result = await super.saveAsset(input);
    await this.persist();
    return result;
  }

  override async deleteAsset(id: string): Promise<void> {
    await super.deleteAsset(id);
    await this.persist();
  }

  override async deleteAssets(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await super.deleteAssets(ids);
    await this.persist();
  }

  override async saveConnection(
    input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
  ): Promise<ProviderConnectionRecord> {
    const result = await super.saveConnection(input);
    await this.persist();
    return result;
  }

  override async deleteConnection(id: string): Promise<void> {
    await super.deleteConnection(id);
    await this.persist();
  }

  override async createRun(
    input: Omit<WorkflowRunRecord, "createdAt" | "updatedAt">,
  ): Promise<WorkflowRunRecord> {
    const result = await super.createRun(input);
    await this.persist();
    return result;
  }

  override async updateRun(
    id: string,
    patch: Partial<Pick<WorkflowRunRecord, "status" | "updatedAt">>,
  ): Promise<WorkflowRunRecord | null> {
    const result = await super.updateRun(id, patch);
    if (result) await this.persist();
    return result;
  }

  override async transitionRunStatus(
    id: string,
    fromStatuses: readonly WorkflowStatus[],
    status: WorkflowStatus,
  ): Promise<WorkflowRunRecord | null> {
    const result = await super.transitionRunStatus(id, fromStatuses, status);
    if (result) await this.persist();
    return result;
  }

  override async createNodeRun(
    input: Omit<NodeRunRecord, "createdAt" | "updatedAt">,
  ): Promise<NodeRunRecord> {
    const result = await super.createNodeRun(input);
    await this.persist();
    return result;
  }

  override async updateNodeRun(
    id: string,
    patch: Partial<Omit<NodeRunRecord, "id" | "createdAt" | "updatedAt">>,
    options: NodeRunUpdateOptions = {},
  ): Promise<NodeRunRecord | null> {
    const result = await super.updateNodeRun(id, patch, options);
    if (result) await this.persist();
    return result;
  }

  override async saveWebhookEvent(input: WebhookEventRecord): Promise<boolean> {
    const saved = await super.saveWebhookEvent(input);
    if (saved) await this.persist();
    return saved;
  }
}
