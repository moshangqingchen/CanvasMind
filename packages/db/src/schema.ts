import {
  boolean,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = (name: string) => text(name).primaryKey();

export const canvases = pgTable("canvas", {
  id: id("id"),
  title: text("title").notNull(),
  graph: jsonb("graph").notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const canvasRevisions = pgTable(
  "canvas_revision",
  {
    id: id("id"),
    canvasId: text("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    graph: jsonb("graph").notNull(),
    reason: text("reason").notNull().default("autosave"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("canvas_revision_canvas_idx").on(table.canvasId)],
);

export const assets = pgTable(
  "asset",
  {
    id: id("id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    storageKey: text("storage_key").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "asset_kind_chk",
      sql`${table.kind} in ('image','video','audio','text')`,
    ),
    check("asset_size_chk", sql`${table.size} >= 0`),
  ],
);

export const providerConnections = pgTable("provider_connection", {
  id: id("id"),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  encryptedSecret: text("encrypted_secret"),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const workflowRuns = pgTable(
  "workflow_run",
  {
    id: id("id"),
    canvasId: text("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    clientRequestId: text("client_request_id").notNull(),
    scope: text("scope").notNull(),
    nodeId: text("node_id"),
    status: text("status").notNull(),
    revisionGraph: jsonb("revision_graph").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("workflow_run_canvas_client_uq").on(
      table.canvasId,
      table.clientRequestId,
    ),
    check(
      "workflow_run_scope_chk",
      sql`${table.scope} in ('node','downstream','all')`,
    ),
    check(
      "workflow_run_status_chk",
      sql`${table.status} in ('queued','running','succeeded','failed','cancelled','needs_attention')`,
    ),
  ],
);

export const nodeRuns = pgTable(
  "node_run",
  {
    id: id("id"),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(0),
    providerTaskId: text("provider_task_id"),
    inputJson: jsonb("input_json").notNull().default({}),
    outputAssetIds: jsonb("output_asset_ids").notNull().default([]),
    errorJson: jsonb("error_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("node_run_workflow_idx").on(table.workflowRunId),
    uniqueIndex("node_run_workflow_node_uq").on(
      table.workflowRunId,
      table.nodeId,
    ),
    index("node_run_node_status_updated_idx").on(
      table.nodeId,
      table.status,
      table.updatedAt,
    ),
    index("node_run_provider_task_idx").on(table.providerTaskId),
    check(
      "node_run_status_chk",
      sql`${table.status} in ('blocked','queued','submitting','running','archiving','succeeded','failed','cancel_requested','cancelled','needs_attention')`,
    ),
    check("node_run_attempt_chk", sql`${table.attempt} >= 0`),
  ],
);

export const webhookEvents = pgTable(
  "webhook_event",
  {
    id: id("id"),
    provider: text("provider").notNull(),
    connectionId: text("connection_id").references(
      () => providerConnections.id,
      { onDelete: "cascade" },
    ),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("webhook_event_provider_connection_external_uq").on(
      table.provider,
      table.connectionId,
      table.externalId,
    ),
  ],
);
