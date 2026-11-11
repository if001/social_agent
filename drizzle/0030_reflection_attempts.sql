CREATE TABLE "reflection_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "reflection_id" text NOT NULL REFERENCES "reflection_runs"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "target" text NOT NULL,
  "status" text NOT NULL,
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb,
  "failure_reason" text,
  "tool_executions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reflection_attempts_target_check" CHECK ("target" IN ('memory','concern','relationship','self-mood')),
  CONSTRAINT "reflection_attempts_status_check" CHECK ("status" IN ('pending','completed','failed','blocked')),
  CONSTRAINT "reflection_attempts_reflection_target_uidx" UNIQUE ("reflection_id","target")
);
--> statement-breakpoint
CREATE INDEX "reflection_attempts_agent_reflection_idx" ON "reflection_attempts" USING btree ("agent_id","reflection_id","target");
--> statement-breakpoint
ALTER TABLE "reflection_runs" ADD COLUMN "retry_count" integer NOT NULL DEFAULT 0;
