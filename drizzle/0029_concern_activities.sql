CREATE TABLE "concern_activities" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "concern_id" text NOT NULL,
  "kind" text NOT NULL,
  "event_id" text REFERENCES "events"("id") ON DELETE SET NULL,
  "run_id" text REFERENCES "agent_runs"("id") ON DELETE SET NULL,
  "reflection_id" text REFERENCES "reflection_runs"("id") ON DELETE SET NULL,
  "evidence_memory_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "concern_activities_agent_concern_occurred_idx" ON "concern_activities" USING btree ("agent_id","concern_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "concern_activities_agent_reflection_idx" ON "concern_activities" USING btree ("agent_id","reflection_id");
--> statement-breakpoint
INSERT INTO "concern_activities" ("id","agent_id","concern_id","kind","evidence_memory_ids","occurred_at")
SELECT 'baseline:' || s.agent_id || ':' || (concern.value->>'id'), s.agent_id, (concern.value->>'id'), 'baseline', '[]'::jsonb, now()
FROM "agent_states" s
CROSS JOIN LATERAL jsonb_array_elements(s.concerns) AS concern(value)
WHERE concern.value ? 'id'
ON CONFLICT ("id") DO NOTHING;
