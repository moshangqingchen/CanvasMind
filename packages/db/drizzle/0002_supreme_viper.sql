DROP INDEX "webhook_event_provider_external_uq";--> statement-breakpoint
ALTER TABLE "webhook_event" ADD COLUMN "connection_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_provider_connection_external_uq" ON "webhook_event" USING btree ("provider","connection_id","external_id");