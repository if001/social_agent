ALTER TABLE "app"."conversations" ADD COLUMN "ended_reason" text;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD COLUMN "completed_at" timestamp with time zone;