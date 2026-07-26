ALTER TABLE "asset" DROP CONSTRAINT "asset_kind_chk";--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_kind_chk" CHECK ("asset"."kind" in ('image','video','audio','text'));