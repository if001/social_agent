ALTER TABLE "app"."concerns" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "app"."concerns" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "app"."concerns" ADD COLUMN "embedding_dimension" integer;--> statement-breakpoint
ALTER TABLE "app"."concerns" ADD COLUMN "embedding_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."concerns" ADD COLUMN "embedding_error" text;--> statement-breakpoint
ALTER TABLE "app"."concerns" ADD COLUMN "embedding_last_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "concerns_embedding_status_idx" ON "app"."concerns" USING btree ("embedding_status","agent_id");