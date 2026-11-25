CREATE TABLE "app"."concern_reevaluation_batch_memories" (
	"batch_id" text NOT NULL,
	"memory_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concern_reevaluation_batch_memories_batch_id_memory_id_pk" PRIMARY KEY("batch_id","memory_id")
);
--> statement-breakpoint
CREATE TABLE "app"."concern_reevaluation_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_event_id" text,
	"source_run_id" text,
	"focus_concern_id" text,
	"status" text NOT NULL,
	"impact_reason" text,
	"failure_reason" text,
	"next_due_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_batch_memories" ADD CONSTRAINT "concern_reevaluation_batch_memories_batch_id_concern_reevaluation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "app"."concern_reevaluation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_batch_memories" ADD CONSTRAINT "concern_reevaluation_batch_memories_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "app"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_batches" ADD CONSTRAINT "concern_reevaluation_batches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_batches" ADD CONSTRAINT "concern_reevaluation_batches_source_event_id_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "app"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_batches" ADD CONSTRAINT "concern_reevaluation_batches_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "app"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_batches" ADD CONSTRAINT "concern_reevaluation_batches_focus_concern_id_concerns_id_fk" FOREIGN KEY ("focus_concern_id") REFERENCES "app"."concerns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concern_reevaluation_batches_source_uidx" ON "app"."concern_reevaluation_batches" USING btree ("agent_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "concern_reevaluation_batches_due_idx" ON "app"."concern_reevaluation_batches" USING btree ("agent_id","status","focus_concern_id","next_due_at","lease_until");