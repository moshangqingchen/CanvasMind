CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"canvas_id" text NOT NULL,
	"graph" jsonb NOT NULL,
	"reason" text DEFAULT 'autosave' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"graph" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"provider_task_id" text,
	"input_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_json" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_secret" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" text PRIMARY KEY NOT NULL,
	"canvas_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"scope" text NOT NULL,
	"node_id" text,
	"status" text NOT NULL,
	"revision_graph" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "canvas_revision_canvas_idx" ON "canvas_revision" USING btree ("canvas_id");--> statement-breakpoint
CREATE INDEX "node_run_workflow_idx" ON "node_run" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_provider_external_uq" ON "webhook_event" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_canvas_client_uq" ON "workflow_run" USING btree ("canvas_id","client_request_id");