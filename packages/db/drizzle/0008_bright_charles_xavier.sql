CREATE TABLE "supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"supplier_key" text NOT NULL,
	"site_url" text DEFAULT '' NOT NULL,
	"api_url" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'auto' NOT NULL,
	"catalog" jsonb DEFAULT '{"groups":[]}'::jsonb NOT NULL,
	"scan_status" text DEFAULT 'unscanned' NOT NULL,
	"scanned_at" text,
	"scan_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
