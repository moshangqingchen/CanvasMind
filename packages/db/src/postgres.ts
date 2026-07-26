import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type {
  AssetRecord,
  CanvasRecord,
  CanvasRevisionRecord,
  JsonObject,
  NodeRunRecord,
  ProviderConnectionRecord,
  Repository,
  NodeRunUpdateOptions,
  WebhookEventRecord,
  WorkflowRunRecord,
} from "./types.js";

const iso = (value: Date | string | undefined): string =>
  value instanceof Date
    ? value.toISOString()
    : (value ?? new Date().toISOString());
const json = (value: unknown): string => JSON.stringify(value ?? {});
const parse = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

export class PostgresRepository implements Repository {
  readonly pool: Pool;
  private ready?: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool
        .query("SELECT 1")
        .then(() => undefined)
        .catch((error) => {
          // A transient startup failure must not poison the repository for the
          // lifetime of the web process. The next request gets a fresh probe.
          this.ready = undefined;
          throw error;
        });
    }
    return this.ready;
  }

  async ensureDefaultCanvas(): Promise<CanvasRecord> {
    await this.ensureReady();
    const existing = await this.getFirstCanvas();
    if (existing) return existing;
    return this.saveCanvas({
      id: randomUUID(),
      title: "我的第一个工作流",
      graph: {
        schemaVersion: 1,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      reason: "initial",
    });
  }

  private async getFirstCanvas(): Promise<CanvasRecord | null> {
    const result = await this.pool.query(
      "SELECT * FROM canvas ORDER BY created_at LIMIT 1",
    );
    return result.rows[0] ? this.canvasRow(result.rows[0]) : null;
  }

  private canvasRow(row: Record<string, unknown>): CanvasRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      graph: parse<JsonObject>(row.graph, {}),
      revision: Number(row.revision ?? 0),
      createdAt: iso(row.created_at as Date),
      updatedAt: iso(row.updated_at as Date),
    };
  }

  async listCanvases(): Promise<CanvasRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM canvas ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => this.canvasRow(row));
  }
  async getCanvas(id: string): Promise<CanvasRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query("SELECT * FROM canvas WHERE id=$1", [
      id,
    ]);
    return result.rows[0] ? this.canvasRow(result.rows[0]) : null;
  }

  async saveCanvas(input: {
    id: string;
    title?: string;
    graph: JsonObject;
    reason?: string;
  }): Promise<CanvasRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO canvas(id,title,graph,revision,created_at,updated_at) VALUES($1,$2,$3::jsonb,1,$4,$4)
        ON CONFLICT(id) DO UPDATE SET title=COALESCE($2,canvas.title), graph=$3::jsonb, revision=canvas.revision+1, updated_at=$4 RETURNING *`,
        [input.id, input.title ?? "未命名画布", json(input.graph), timestamp],
      );
      const record = this.canvasRow(result.rows[0]);
      await client.query(
        "INSERT INTO canvas_revision(id,canvas_id,graph,reason,created_at) VALUES($1,$2,$3::jsonb,$4,$5)",
        [
          randomUUID(),
          record.id,
          json(record.graph),
          input.reason ?? "autosave",
          timestamp,
        ],
      );
      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listRevisions(canvasId: string): Promise<CanvasRevisionRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM canvas_revision WHERE canvas_id=$1 ORDER BY created_at DESC",
      [canvasId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      canvasId: String(row.canvas_id),
      graph: parse<JsonObject>(row.graph, {}),
      reason: String(row.reason),
      createdAt: iso(row.created_at as Date),
    }));
  }
  async listAssets(): Promise<AssetRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM asset WHERE deleted=false ORDER BY created_at DESC",
    );
    return result.rows.map((row) => this.assetRow(row));
  }
  async getAsset(id: string): Promise<AssetRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM asset WHERE id=$1 AND deleted=false",
      [id],
    );
    return result.rows[0] ? this.assetRow(result.rows[0]) : null;
  }
  private assetRow(row: Record<string, unknown>): AssetRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      kind: row.kind as AssetRecord["kind"],
      mimeType: String(row.mime_type),
      size: Number(row.size ?? 0),
      storageKey: String(row.storage_key),
      metadata: parse<JsonObject>(row.metadata, {}),
      deleted: Boolean(row.deleted),
      createdAt: iso(row.created_at as Date),
    };
  }
  async saveAsset(
    input: Omit<AssetRecord, "createdAt" | "deleted"> & {
      createdAt?: string;
      deleted?: boolean;
    },
  ): Promise<AssetRecord> {
    await this.ensureReady();
    const timestamp = input.createdAt ?? iso(undefined);
    const result = await this.pool.query(
      `INSERT INTO asset(id,name,kind,mime_type,size,storage_key,metadata,deleted,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       ON CONFLICT(id) DO UPDATE SET
         name=EXCLUDED.name,
         kind=EXCLUDED.kind,
         mime_type=EXCLUDED.mime_type,
         size=EXCLUDED.size,
         storage_key=EXCLUDED.storage_key,
         metadata=EXCLUDED.metadata,
         deleted=EXCLUDED.deleted
       RETURNING *`,
      [
        input.id,
        input.name,
        input.kind,
        input.mimeType,
        input.size,
        input.storageKey,
        json(input.metadata),
        input.deleted ?? false,
        timestamp,
      ],
    );
    return this.assetRow(result.rows[0]);
  }
  async deleteAsset(id: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query("UPDATE asset SET deleted=true WHERE id=$1", [id]);
  }

  async listConnections(): Promise<ProviderConnectionRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM provider_connection ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => this.connectionRow(row));
  }
  async getConnection(id: string): Promise<ProviderConnectionRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM provider_connection WHERE id=$1",
      [id],
    );
    return result.rows[0] ? this.connectionRow(result.rows[0]) : null;
  }
  private connectionRow(
    row: Record<string, unknown>,
  ): ProviderConnectionRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      provider: String(row.provider),
      encryptedSecret: row.encrypted_secret as string | null,
      config: parse<JsonObject>(row.config, {}),
      createdAt: iso(row.created_at as Date),
      updatedAt: iso(row.updated_at as Date),
    };
  }
  async saveConnection(
    input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
  ): Promise<ProviderConnectionRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const result = await this.pool.query(
      `INSERT INTO provider_connection(id,name,provider,encrypted_secret,config,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6) ON CONFLICT(id) DO UPDATE SET name=$2,provider=$3,encrypted_secret=COALESCE($4,provider_connection.encrypted_secret),config=$5::jsonb,updated_at=$6 RETURNING *`,
      [
        input.id,
        input.name,
        input.provider,
        input.encryptedSecret ?? null,
        json(input.config),
        timestamp,
      ],
    );
    return this.connectionRow(result.rows[0]);
  }
  async deleteConnection(id: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query("DELETE FROM provider_connection WHERE id=$1", [id]);
  }

  private runRow(row: Record<string, unknown>): WorkflowRunRecord {
    return {
      id: String(row.id),
      canvasId: String(row.canvas_id),
      clientRequestId: String(row.client_request_id),
      scope: row.scope as WorkflowRunRecord["scope"],
      nodeId: row.node_id as string | null,
      status: row.status as WorkflowRunRecord["status"],
      revisionGraph: parse<JsonObject>(row.revision_graph, {}),
      createdAt: iso(row.created_at as Date),
      updatedAt: iso(row.updated_at as Date),
    };
  }
  async getRunByClientRequest(
    canvasId: string,
    clientRequestId: string,
  ): Promise<WorkflowRunRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM workflow_run WHERE canvas_id=$1 AND client_request_id=$2",
      [canvasId, clientRequestId],
    );
    return result.rows[0] ? this.runRow(result.rows[0]) : null;
  }
  async createRun(
    input: Omit<WorkflowRunRecord, "createdAt" | "updatedAt">,
  ): Promise<WorkflowRunRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const result = await this.pool.query(
      `INSERT INTO workflow_run(id,canvas_id,client_request_id,scope,node_id,status,revision_graph,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)
       ON CONFLICT(canvas_id,client_request_id) DO UPDATE
       SET client_request_id=workflow_run.client_request_id
       RETURNING *`,
      [
        input.id,
        input.canvasId,
        input.clientRequestId,
        input.scope,
        input.nodeId ?? null,
        input.status,
        json(input.revisionGraph),
        timestamp,
      ],
    );
    return this.runRow(result.rows[0]);
  }
  async getRun(id: string): Promise<WorkflowRunRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM workflow_run WHERE id=$1",
      [id],
    );
    return result.rows[0] ? this.runRow(result.rows[0]) : null;
  }
  async listRuns(canvasId?: string): Promise<WorkflowRunRecord[]> {
    await this.ensureReady();
    const result = canvasId
      ? await this.pool.query(
          "SELECT * FROM workflow_run WHERE canvas_id=$1 ORDER BY created_at DESC LIMIT 100",
          [canvasId],
        )
      : await this.pool.query(
          "SELECT * FROM workflow_run ORDER BY created_at DESC LIMIT 100",
        );
    return result.rows.map((row) => this.runRow(row));
  }
  async listRunsByStatus(
    statuses: readonly WorkflowRunRecord["status"][],
  ): Promise<WorkflowRunRecord[]> {
    await this.ensureReady();
    if (statuses.length === 0) return [];
    const result = await this.pool.query(
      "SELECT * FROM workflow_run WHERE status=ANY($1::text[]) ORDER BY created_at",
      [statuses],
    );
    return result.rows.map((row) => this.runRow(row));
  }
  async listRecoverableRuns(): Promise<WorkflowRunRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM workflow_run WHERE status IN ('queued','running') ORDER BY created_at",
    );
    return result.rows.map((row) => this.runRow(row));
  }
  async updateRun(
    id: string,
    patch: Partial<Pick<WorkflowRunRecord, "status" | "updatedAt">>,
  ): Promise<WorkflowRunRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      `UPDATE workflow_run
       SET status=COALESCE($2,status),updated_at=COALESCE($3,now())
       WHERE id=$1
         AND NOT(status='cancelled' AND $2 IS NOT NULL AND $2<>'cancelled')
       RETURNING *`,
      [id, patch.status ?? null, patch.updatedAt ?? null],
    );
    if (result.rows[0]) return this.runRow(result.rows[0]);
    return this.getRun(id);
  }

  async transitionRunStatus(
    id: string,
    fromStatuses: readonly WorkflowRunRecord["status"][],
    status: WorkflowRunRecord["status"],
  ): Promise<WorkflowRunRecord | null> {
    await this.ensureReady();
    if (fromStatuses.length === 0) return null;
    const result = await this.pool.query(
      "UPDATE workflow_run SET status=$3,updated_at=now() WHERE id=$1 AND status=ANY($2::text[]) RETURNING *",
      [id, [...fromStatuses], status],
    );
    return result.rows[0] ? this.runRow(result.rows[0]) : null;
  }

  private nodeRow(row: Record<string, unknown>): NodeRunRecord {
    return {
      id: String(row.id),
      workflowRunId: String(row.workflow_run_id),
      nodeId: String(row.node_id),
      status: row.status as NodeRunRecord["status"],
      attempt: Number(row.attempt ?? 0),
      providerTaskId: row.provider_task_id as string | null,
      inputJson: parse<JsonObject>(row.input_json, {}),
      outputAssetIds: parse<string[]>(row.output_asset_ids, []),
      errorJson: parse<JsonObject | null>(row.error_json, null),
      createdAt: iso(row.created_at as Date),
      updatedAt: iso(row.updated_at as Date),
    };
  }
  async listNodeRuns(runId: string): Promise<NodeRunRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM node_run WHERE workflow_run_id=$1 ORDER BY created_at",
      [runId],
    );
    return result.rows.map((row) => this.nodeRow(row));
  }
  async createNodeRun(
    input: Omit<NodeRunRecord, "createdAt" | "updatedAt">,
  ): Promise<NodeRunRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const result = await this.pool.query(
      `INSERT INTO node_run(id,workflow_run_id,node_id,status,attempt,provider_task_id,input_json,output_asset_ids,error_json,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$10)
       ON CONFLICT(workflow_run_id,node_id) DO UPDATE
       SET node_id=node_run.node_id
       RETURNING *`,
      [
        input.id,
        input.workflowRunId,
        input.nodeId,
        input.status,
        input.attempt,
        input.providerTaskId ?? null,
        json(input.inputJson),
        json(input.outputAssetIds),
        input.errorJson ? json(input.errorJson) : null,
        timestamp,
      ],
    );
    return this.nodeRow(result.rows[0]);
  }
  async updateNodeRun(
    id: string,
    patch: Partial<Omit<NodeRunRecord, "id" | "createdAt" | "updatedAt">>,
    options: NodeRunUpdateOptions = {},
  ): Promise<NodeRunRecord | null> {
    await this.ensureReady();
    const values: unknown[] = [id];
    const sets: string[] = [];
    const add = (expression: string, value: unknown, jsonb = false) => {
      values.push(value);
      sets.push(`${expression}=$${values.length}${jsonb ? "::jsonb" : ""}`);
    };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.attempt !== undefined) add("attempt", patch.attempt);
    if (patch.providerTaskId !== undefined)
      add("provider_task_id", patch.providerTaskId ?? null);
    if (patch.inputJson !== undefined)
      add("input_json", json(patch.inputJson), true);
    if (patch.outputAssetIds !== undefined)
      add("output_asset_ids", json(patch.outputAssetIds), true);
    if (patch.errorJson !== undefined)
      add(
        "error_json",
        patch.errorJson === null ? null : json(patch.errorJson),
        true,
      );
    sets.push("updated_at=now()");
    const conditions = ["id=$1"];
    if (options.expectedStatus !== undefined) {
      values.push(options.expectedStatus);
      conditions.push(`status=$${values.length}`);
    }
    if (options.expectedUpdatedAt !== undefined) {
      values.push(options.expectedUpdatedAt);
      conditions.push(`updated_at=$${values.length}::timestamptz`);
    }
    // Cancellation is monotonic. A late poll/archive/webhook must not move a
    // node out of either the pending-cancellation or cancelled state.
    if (patch.status !== undefined && patch.status !== "cancelled") {
      conditions.push("status<>'cancelled'");
      if (patch.status !== "cancel_requested")
        conditions.push("status<>'cancel_requested'");
    }
    if (sets.length === 1) return this.getNodeRun(id);
    const result = await this.pool.query(
      `UPDATE node_run SET ${sets.join(",")} WHERE ${conditions.join(
        " AND ",
      )} RETURNING *`,
      values,
    );
    if (result.rows[0]) return this.nodeRow(result.rows[0]);
    // A missing row and a CAS conflict are both represented as null. Callers
    // can re-read the row when they need to distinguish the two cases.
    return null;
  }
  async getNodeRun(id: string): Promise<NodeRunRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query("SELECT * FROM node_run WHERE id=$1", [
      id,
    ]);
    return result.rows[0] ? this.nodeRow(result.rows[0]) : null;
  }
  async findNodeRunByProviderTaskId(
    providerTaskId: string,
    connectionId?: string,
  ): Promise<NodeRunRecord | null> {
    await this.ensureReady();
    const result = connectionId
      ? await this.pool.query(
          "SELECT * FROM node_run WHERE provider_task_id=$1 AND input_json->>'connectionId'=$2 ORDER BY created_at DESC LIMIT 1",
          [providerTaskId, connectionId],
        )
      : await this.pool.query(
          "SELECT * FROM node_run WHERE provider_task_id=$1 ORDER BY created_at DESC LIMIT 1",
          [providerTaskId],
        );
    return result.rows[0] ? this.nodeRow(result.rows[0]) : null;
  }

  async findLatestSucceededNodeRun(
    canvasId: string,
    nodeId: string,
  ): Promise<NodeRunRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      `SELECT node_run.*
       FROM node_run
       INNER JOIN workflow_run ON workflow_run.id=node_run.workflow_run_id
       WHERE workflow_run.canvas_id=$1
         AND node_run.node_id=$2
         AND node_run.status='succeeded'
         AND jsonb_typeof(node_run.output_asset_ids)='array'
         AND jsonb_array_length(node_run.output_asset_ids)>0
       ORDER BY node_run.updated_at DESC,node_run.created_at DESC,node_run.id DESC
       LIMIT 1`,
      [canvasId, nodeId],
    );
    return result.rows[0] ? this.nodeRow(result.rows[0]) : null;
  }
  async saveWebhookEvent(input: WebhookEventRecord): Promise<boolean> {
    await this.ensureReady();
    const result = await this.pool.query(
      "INSERT INTO webhook_event(id,provider,connection_id,external_id,payload,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(provider,connection_id,external_id) DO NOTHING",
      [
        input.id,
        input.provider,
        input.connectionId ?? null,
        input.externalId,
        json(input.payload),
        input.createdAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
