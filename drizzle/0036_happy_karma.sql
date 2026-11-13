CREATE TABLE "app"."reflection_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"reflection_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"target" text NOT NULL,
	"batch_index" integer,
	"anchor_memory_id" text,
	"resolver_version" text NOT NULL,
	"query_summary" text NOT NULL,
	"candidate_count" integer NOT NULL,
	"selected_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"temporal_decision" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflection_resolutions_target_check" CHECK ("app"."reflection_resolutions"."target" IN ('formation','reconciliation')),
	CONSTRAINT "reflection_resolutions_outcome_check" CHECK ("app"."reflection_resolutions"."outcome" IN ('committed','no-op','deferred','retryable','conflict'))
);
--> statement-breakpoint
ALTER TABLE "app"."reflection_attempts" DROP CONSTRAINT "reflection_attempts_target_check";--> statement-breakpoint
ALTER TABLE "app"."reflection_attempts" DROP CONSTRAINT "reflection_attempts_status_check";--> statement-breakpoint
ALTER TABLE "app"."reflection_resolutions" ADD CONSTRAINT "reflection_resolutions_reflection_id_reflection_runs_id_fk" FOREIGN KEY ("reflection_id") REFERENCES "app"."reflection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reflection_resolutions" ADD CONSTRAINT "reflection_resolutions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reflection_resolutions_reflection_target_idx" ON "app"."reflection_resolutions" USING btree ("reflection_id","target","batch_index");--> statement-breakpoint
ALTER TABLE "app"."reflection_attempts" ADD CONSTRAINT "reflection_attempts_target_check" CHECK ("app"."reflection_attempts"."target" IN ('memory', 'reconciliation', 'concern', 'relationship', 'self-mood'));--> statement-breakpoint
ALTER TABLE "app"."reflection_attempts" ADD CONSTRAINT "reflection_attempts_status_check" CHECK ("app"."reflection_attempts"."status" IN ('pending', 'completed', 'failed', 'blocked'));