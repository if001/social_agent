DROP INDEX "app"."memory_mutations_event_intent_uidx";--> statement-breakpoint
ALTER TABLE "app"."g3_tasks" ADD COLUMN "source_run_id" text;--> statement-breakpoint
ALTER TABLE "app"."g3_tasks" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."g3_tasks" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."g3_tasks" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "candidate_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "source_run_id" text;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "evidence_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "evidence_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "status" text DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "app"."memory_mutations" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "memory_mutations_source_intent_idx" ON "app"."memory_mutations" USING btree ("agent_id","source_kind","source_id","intent_index");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_mutations_source_attempt_uidx" ON "app"."memory_mutations" USING btree ("agent_id","source_kind","source_id","intent_index","attempt");--> statement-breakpoint
CREATE INDEX "prediction_evaluations_prediction_created_idx" ON "app"."prediction_evaluations" USING btree ("prediction_id","created_at");--> statement-breakpoint
CREATE INDEX "prediction_records_source_run_created_idx" ON "app"."prediction_records" USING btree ("source_run_id","created_at");--> statement-breakpoint
CREATE INDEX "runtime_correlations_created_idx" ON "app"."runtime_correlations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runtime_rate_windows_start_idx" ON "app"."runtime_rate_windows" USING btree ("window_start");