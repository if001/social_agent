CREATE TABLE "scheduled_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"execute_at" timestamp with time zone NOT NULL,
	"instruction" text NOT NULL,
	"reason" text,
	"destination" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_event_id" text NOT NULL,
	"source_run_id" text NOT NULL,
	"execution_event_id" text,
	"lease_until" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_tasks_owner_idempotency_uidx" ON "scheduled_tasks" USING btree ("agent_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_due_idx" ON "scheduled_tasks" USING btree ("status","execute_at","lease_until","agent_id");
