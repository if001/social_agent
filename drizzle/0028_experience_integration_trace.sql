CREATE TABLE "experience_integrations" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "source_event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "source_run_id" text NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "input" jsonb NOT NULL,
  "output" jsonb,
  "applied" jsonb,
  "failure_reason" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "experience_integrations_source_run_uidx" ON "experience_integrations" ("agent_id","source_run_id");
--> statement-breakpoint
CREATE INDEX "experience_integrations_agent_created_idx" ON "experience_integrations" ("agent_id","created_at");
