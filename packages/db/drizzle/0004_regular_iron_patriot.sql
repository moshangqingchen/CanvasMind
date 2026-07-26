ALTER TABLE "canvas_revision" ADD CONSTRAINT "canvas_revision_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_run" ADD CONSTRAINT "node_run_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_connection_id_provider_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_kind_chk" CHECK ("asset"."kind" in ('image','video','text'));--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_size_chk" CHECK ("asset"."size" >= 0);--> statement-breakpoint
ALTER TABLE "node_run" ADD CONSTRAINT "node_run_status_chk" CHECK ("node_run"."status" in ('blocked','queued','submitting','running','archiving','succeeded','failed','cancel_requested','cancelled','needs_attention'));--> statement-breakpoint
ALTER TABLE "node_run" ADD CONSTRAINT "node_run_attempt_chk" CHECK ("node_run"."attempt" >= 0);--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_scope_chk" CHECK ("workflow_run"."scope" in ('node','downstream','all'));--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_status_chk" CHECK ("workflow_run"."status" in ('queued','running','succeeded','failed','cancelled','needs_attention'));