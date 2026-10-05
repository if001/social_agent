CREATE TABLE "post_process_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"event_id" text NOT NULL,
	"interaction_run_id" text NOT NULL,
	"input_state_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"failure_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_process_jobs_interaction_run_id_unique" UNIQUE("interaction_run_id")
);
--> statement-breakpoint
ALTER TABLE "post_process_jobs" ADD CONSTRAINT "post_process_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_process_jobs" ADD CONSTRAINT "post_process_jobs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_process_jobs" ADD CONSTRAINT "post_process_jobs_interaction_run_id_agent_runs_id_fk" FOREIGN KEY ("interaction_run_id") REFERENCES "agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_process_jobs_due_idx" ON "post_process_jobs" USING btree ("agent_id","status","available_at","lease_until");
