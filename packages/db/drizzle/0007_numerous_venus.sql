CREATE TABLE "director_message" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "director_message_role_chk" CHECK ("director_message"."role" in ('user','assistant','system'))
);
--> statement-breakpoint
CREATE TABLE "director_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"brain_connection_id" text NOT NULL,
	"brain_model_id" text NOT NULL,
	"research_connection_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "director_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"canvas_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"base_canvas_revision" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"quote" jsonb NOT NULL,
	"knowledge_version" text NOT NULL,
	"catalog_fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"workflow_run_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "director_proposal_version_chk" CHECK ("director_proposal"."version" >= 1),
	CONSTRAINT "director_proposal_canvas_revision_chk" CHECK ("director_proposal"."base_canvas_revision" >= 0),
	CONSTRAINT "director_proposal_status_chk" CHECK ("director_proposal"."status" in ('draft','awaiting_approval','approved','cancelled','expired','running','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "director_session" (
	"id" text PRIMARY KEY NOT NULL,
	"canvas_id" text NOT NULL,
	"profile_id" text,
	"title" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run" DROP CONSTRAINT "workflow_run_scope_chk";--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "director_message" ADD CONSTRAINT "director_message_session_id_director_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."director_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_profile" ADD CONSTRAINT "director_profile_brain_connection_id_provider_connection_id_fk" FOREIGN KEY ("brain_connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_profile" ADD CONSTRAINT "director_profile_research_connection_id_provider_connection_id_fk" FOREIGN KEY ("research_connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_proposal" ADD CONSTRAINT "director_proposal_session_id_director_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."director_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_proposal" ADD CONSTRAINT "director_proposal_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_proposal" ADD CONSTRAINT "director_proposal_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_session" ADD CONSTRAINT "director_session_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_session" ADD CONSTRAINT "director_session_profile_id_director_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."director_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "director_message_session_created_idx" ON "director_message" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "director_proposal_session_created_idx" ON "director_proposal" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "director_proposal_workflow_run_uq" ON "director_proposal" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "director_session_canvas_updated_idx" ON "director_session" USING btree ("canvas_id","updated_at");--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_scope_chk" CHECK ("workflow_run"."scope" in ('node','downstream','selection','all'));