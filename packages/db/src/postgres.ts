import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type {
  AssetRecord,
  CanvasRecord,
  CanvasRevisionRecord,
  DirectorMessageRecord,
  DirectorProfileRecord,
  DirectorProposalRecord,
  DirectorProposalUpdateOptions,
  DirectorSessionRecord,
  JsonObject,
  NodeRunRecord,
  ProviderConnectionRecord,
  Repository,
  NodeRunUpdateOptions,
  WebhookEventRecord,
  WorkflowRunRecord,
} from "./types.js";
import { CanvasRevisionConflictError } from "./types.js";

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

  async deleteCanvas(id: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query("DELETE FROM canvas WHERE id=$1", [id]);
  }

  async saveCanvas(input: {
    id: string;
    title?: string;
    graph: JsonObject;
    reason?: string;
    expectedRevision?: number;
  }): Promise<CanvasRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const values = [
        input.id,
        input.title ?? "未命名画布",
        json(input.graph),
        timestamp,
      ];
      const result =
        input.expectedRevision === undefined
          ? await client.query(
              `INSERT INTO canvas(id,title,graph,revision,created_at,updated_at) VALUES($1,$2,$3::jsonb,1,$4,$4)
              ON CONFLICT(id) DO UPDATE SET title=COALESCE($2,canvas.title), graph=$3::jsonb, revision=canvas.revision+1, updated_at=$4 RETURNING *`,
              values,
            )
          : await client.query(
              `WITH updated AS (
                UPDATE canvas
                SET title=COALESCE($2,canvas.title), graph=$3::jsonb,
                    revision=canvas.revision+1, updated_at=$4
                WHERE id=$1 AND revision=$5
                RETURNING *
              ), inserted AS (
                INSERT INTO canvas(id,title,graph,revision,created_at,updated_at)
                SELECT $1,$2,$3::jsonb,1,$4,$4
                WHERE $5=0 AND NOT EXISTS (SELECT 1 FROM canvas WHERE id=$1)
                ON CONFLICT(id) DO NOTHING
                RETURNING *
              )
              SELECT * FROM updated
              UNION ALL
              SELECT * FROM inserted`,
              [...values, input.expectedRevision],
            );
      if (!result.rows[0] && input.expectedRevision !== undefined) {
        const current = await client.query(
          "SELECT revision FROM canvas WHERE id=$1",
          [input.id],
        );
        throw new CanvasRevisionConflictError(
          input.expectedRevision,
          Number(current.rows[0]?.revision ?? 0),
        );
      }
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

  async deleteAssets(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureReady();
    await this.pool.query(
      "UPDATE asset SET deleted=true WHERE id = ANY($1::text[])",
      [ids],
    );
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

  private directorProfileRow(
    row: Record<string, unknown>,
  ): DirectorProfileRecord {
    return {
      id: String(row.id),
      brainConnectionId: String(row.brain_connection_id),
      brainModelId: String(row.brain_model_id),
      researchConnectionId: row.research_connection_id as string | null,
      config: parse<JsonObject>(row.config, {}),
      createdAt: iso(row.created_at as Date),
      updatedAt: iso(row.updated_at as Date),
    };
  }

  async getDirectorProfile(id: string): Promise<DirectorProfileRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM director_profile WHERE id=$1",
      [id],
    );
    return result.rows[0] ? this.directorProfileRow(result.rows[0]) : null;
  }

  async saveDirectorProfile(
    input: Omit<DirectorProfileRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorProfileRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const result = await this.pool.query(
      `INSERT INTO director_profile(id,brain_connection_id,brain_model_id,research_connection_id,config,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)
       ON CONFLICT(id) DO UPDATE
       SET brain_connection_id=$2,brain_model_id=$3,research_connection_id=$4,config=$5::jsonb,updated_at=$6
       RETURNING *`,
      [
        input.id,
        input.brainConnectionId,
        input.brainModelId,
        input.researchConnectionId ?? null,
        json(input.config),
        timestamp,
      ],
    );
    return this.directorProfileRow(result.rows[0]);
  }

  async deleteDirectorProfile(id: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query("DELETE FROM director_profile WHERE id=$1", [id]);
  }

  private directorSessionRow(
    row: Record<string, unknown>,
  ): DirectorSessionRecord {
    return {
      id: String(row.id),
      canvasId: String(row.canvas_id),
      profileId: row.profile_id as string | null,
      title: String(row.title),
      metadata: parse<JsonObject>(row.metadata, {}),
      createdAt: iso(row.created_at as Date),
      updatedAt: iso(row.updated_at as Date),
    };
  }

  async createDirectorSession(
    input: Omit<DirectorSessionRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorSessionRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const result = await this.pool.query(
      `INSERT INTO director_session(id,canvas_id,profile_id,title,metadata,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$6) RETURNING *`,
      [
        input.id,
        input.canvasId,
        input.profileId ?? null,
        input.title,
        json(input.metadata),
        timestamp,
      ],
    );
    return this.directorSessionRow(result.rows[0]);
  }

  async getDirectorSession(id: string): Promise<DirectorSessionRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM director_session WHERE id=$1",
      [id],
    );
    return result.rows[0] ? this.directorSessionRow(result.rows[0]) : null;
  }

  async listDirectorSessions(
    canvasId?: string,
  ): Promise<DirectorSessionRecord[]> {
    await this.ensureReady();
    const result = canvasId
      ? await this.pool.query(
          "SELECT * FROM director_session WHERE canvas_id=$1 ORDER BY updated_at DESC",
          [canvasId],
        )
      : await this.pool.query(
          "SELECT * FROM director_session ORDER BY updated_at DESC",
        );
    return result.rows.map((row) => this.directorSessionRow(row));
  }

  async updateDirectorSession(
    id: string,
    patch: Partial<
      Pick<DirectorSessionRecord, "title" | "metadata" | "profileId">
    >,
  ): Promise<DirectorSessionRecord | null> {
    await this.ensureReady();
    const values: unknown[] = [id];
    const sets: string[] = [];
    const add = (column: string, value: unknown, jsonb = false) => {
      values.push(value);
      sets.push(`${column}=$${values.length}${jsonb ? "::jsonb" : ""}`);
    };
    if (patch.title !== undefined) add("title", patch.title);
    if (patch.metadata !== undefined)
      add("metadata", json(patch.metadata), true);
    if (patch.profileId !== undefined) add("profile_id", patch.profileId);
    if (sets.length === 0) return this.getDirectorSession(id);
    sets.push("updated_at=now()");
    const result = await this.pool.query(
      `UPDATE director_session SET ${sets.join(",")} WHERE id=$1 RETURNING *`,
      values,
    );
    return result.rows[0] ? this.directorSessionRow(result.rows[0]) : null;
  }

  async deleteDirectorSession(id: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query("DELETE FROM director_session WHERE id=$1", [id]);
  }

  private directorMessageRow(
    row: Record<string, unknown>,
  ): DirectorMessageRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      role: row.role as DirectorMessageRecord["role"],
      content: String(row.content),
      metadata: parse<JsonObject>(row.metadata, {}),
      createdAt: iso(row.created_at as Date),
    };
  }

  private async touchDirectorSession(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE director_session SET updated_at=now() WHERE id=$1",
      [id],
    );
  }

  async createDirectorMessage(
    input: Omit<DirectorMessageRecord, "createdAt">,
  ): Promise<DirectorMessageRecord> {
    await this.ensureReady();
    const result = await this.pool.query(
      `INSERT INTO director_message(id,session_id,role,content,metadata,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
      [
        input.id,
        input.sessionId,
        input.role,
        input.content,
        json(input.metadata),
        new Date(),
      ],
    );
    await this.touchDirectorSession(input.sessionId);
    return this.directorMessageRow(result.rows[0]);
  }

  async getDirectorMessage(id: string): Promise<DirectorMessageRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM director_message WHERE id=$1",
      [id],
    );
    return result.rows[0] ? this.directorMessageRow(result.rows[0]) : null;
  }

  async listDirectorMessages(
    sessionId: string,
  ): Promise<DirectorMessageRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM director_message WHERE session_id=$1 ORDER BY created_at,id",
      [sessionId],
    );
    return result.rows.map((row) => this.directorMessageRow(row));
  }

  async updateDirectorMessage(
    id: string,
    patch: Partial<Pick<DirectorMessageRecord, "content" | "metadata">>,
  ): Promise<DirectorMessageRecord | null> {
    await this.ensureReady();
    const values: unknown[] = [id];
    const sets: string[] = [];
    if (patch.content !== undefined) {
      values.push(patch.content);
      sets.push(`content=$${values.length}`);
    }
    if (patch.metadata !== undefined) {
      values.push(json(patch.metadata));
      sets.push(`metadata=$${values.length}::jsonb`);
    }
    if (sets.length === 0) return this.getDirectorMessage(id);
    const result = await this.pool.query(
      `UPDATE director_message SET ${sets.join(",")} WHERE id=$1 RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    const record = this.directorMessageRow(result.rows[0]);
    await this.touchDirectorSession(record.sessionId);
    return record;
  }

  async deleteDirectorMessage(id: string): Promise<void> {
    await this.ensureReady();
    const result = await this.pool.query(
      "DELETE FROM director_message WHERE id=$1 RETURNING session_id",
      [id],
    );
    if (result.rows[0])
      await this.touchDirectorSession(String(result.rows[0].session_id));
  }

  private directorProposalRow(
    row: Record<string, unknown>,
  ): DirectorProposalRecord {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      canvasId: String(row.canvas_id),
      version: Number(row.version),
      status: row.status as DirectorProposalRecord["status"],
      baseCanvasRevision: Number(row.base_canvas_revision),
      plan: parse<JsonObject>(row.plan, {}),
      quote: parse<JsonObject>(row.quote, {}),
      knowledgeVersion: String(row.knowledge_version),
      catalogFingerprint: String(row.catalog_fingerprint),
      expiresAt: iso(row.expires_at as Date),
      workflowRunId: row.workflow_run_id as string | null,
      createdAt: iso(row.created_at as Date),
      updatedAt: iso(row.updated_at as Date),
    };
  }

  async createDirectorProposal(
    input: Omit<DirectorProposalRecord, "createdAt" | "updatedAt">,
  ): Promise<DirectorProposalRecord> {
    await this.ensureReady();
    const timestamp = new Date();
    const result = await this.pool.query(
      `INSERT INTO director_proposal(id,session_id,canvas_id,version,status,base_canvas_revision,plan,quote,knowledge_version,catalog_fingerprint,expires_at,workflow_run_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$13) RETURNING *`,
      [
        input.id,
        input.sessionId,
        input.canvasId,
        input.version,
        input.status,
        input.baseCanvasRevision,
        json(input.plan),
        json(input.quote),
        input.knowledgeVersion,
        input.catalogFingerprint,
        input.expiresAt,
        input.workflowRunId ?? null,
        timestamp,
      ],
    );
    await this.touchDirectorSession(input.sessionId);
    return this.directorProposalRow(result.rows[0]);
  }

  async getDirectorProposal(
    id: string,
  ): Promise<DirectorProposalRecord | null> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM director_proposal WHERE id=$1",
      [id],
    );
    return result.rows[0] ? this.directorProposalRow(result.rows[0]) : null;
  }

  async listDirectorProposals(
    sessionId: string,
  ): Promise<DirectorProposalRecord[]> {
    await this.ensureReady();
    const result = await this.pool.query(
      "SELECT * FROM director_proposal WHERE session_id=$1 ORDER BY created_at DESC",
      [sessionId],
    );
    return result.rows.map((row) => this.directorProposalRow(row));
  }

  async updateDirectorProposal(
    id: string,
    patch: Partial<
      Omit<
        DirectorProposalRecord,
        "id" | "sessionId" | "canvasId" | "createdAt" | "updatedAt"
      >
    >,
    options: DirectorProposalUpdateOptions = {},
  ): Promise<DirectorProposalRecord | null> {
    await this.ensureReady();
    if (options.expectedStatuses?.length === 0) return null;
    const values: unknown[] = [id];
    const sets: string[] = [];
    const add = (column: string, value: unknown, jsonb = false) => {
      values.push(value);
      sets.push(`${column}=$${values.length}${jsonb ? "::jsonb" : ""}`);
    };
    if (patch.version !== undefined) add("version", patch.version);
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.baseCanvasRevision !== undefined)
      add("base_canvas_revision", patch.baseCanvasRevision);
    if (patch.plan !== undefined) add("plan", json(patch.plan), true);
    if (patch.quote !== undefined) add("quote", json(patch.quote), true);
    if (patch.knowledgeVersion !== undefined)
      add("knowledge_version", patch.knowledgeVersion);
    if (patch.catalogFingerprint !== undefined)
      add("catalog_fingerprint", patch.catalogFingerprint);
    if (patch.expiresAt !== undefined) add("expires_at", patch.expiresAt);
    if (patch.workflowRunId !== undefined)
      add("workflow_run_id", patch.workflowRunId);
    if (sets.length === 0) return this.getDirectorProposal(id);
    sets.push("updated_at=now()");
    const conditions = ["id=$1"];
    if (options.expectedVersion !== undefined) {
      values.push(options.expectedVersion);
      conditions.push(`version=$${values.length}`);
    }
    if (options.expectedStatuses !== undefined) {
      values.push([...options.expectedStatuses]);
      conditions.push(`status=ANY($${values.length}::text[])`);
    }
    const result = await this.pool.query(
      `UPDATE director_proposal SET ${sets.join(",")} WHERE ${conditions.join(
        " AND ",
      )} RETURNING *`,
      values,
    );
    if (!result.rows[0]) return null;
    const record = this.directorProposalRow(result.rows[0]);
    await this.touchDirectorSession(record.sessionId);
    return record;
  }

  async deleteDirectorProposal(id: string): Promise<void> {
    await this.ensureReady();
    const result = await this.pool.query(
      "DELETE FROM director_proposal WHERE id=$1 RETURNING session_id",
      [id],
    );
    if (result.rows[0])
      await this.touchDirectorSession(String(result.rows[0].session_id));
  }

  private runRow(row: Record<string, unknown>): WorkflowRunRecord {
    return {
      id: String(row.id),
      canvasId: String(row.canvas_id),
      clientRequestId: String(row.client_request_id),
      scope: row.scope as WorkflowRunRecord["scope"],
      nodeId: row.node_id as string | null,
      nodeIds: parse<string[]>(row.node_ids, []),
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
      `INSERT INTO workflow_run(id,canvas_id,client_request_id,scope,node_id,node_ids,status,revision_graph,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$9)
       ON CONFLICT(canvas_id,client_request_id) DO UPDATE
       SET client_request_id=workflow_run.client_request_id
       RETURNING *`,
      [
        input.id,
        input.canvasId,
        input.clientRequestId,
        input.scope,
        input.nodeId ?? null,
        json(input.nodeIds ?? []),
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
