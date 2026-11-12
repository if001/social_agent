CREATE TABLE "reflection_memory_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "reflection_id" text NOT NULL REFERENCES "reflection_runs"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "batch_index" integer NOT NULL,
  "status" text NOT NULL,
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb,
  "failure_reason" text,
  "tool_executions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reflection_memory_batches_status_check" CHECK ("status" IN ('pending','completed','failed')),
  CONSTRAINT "reflection_memory_batches_reflection_batch_uidx" UNIQUE ("reflection_id","batch_index")
);
--> statement-breakpoint
CREATE INDEX "reflection_memory_batches_agent_reflection_idx" ON "reflection_memory_batches" USING btree ("agent_id","reflection_id","batch_index");
