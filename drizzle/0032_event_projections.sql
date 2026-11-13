CREATE TABLE "event_projections" (
  "event_id" text PRIMARY KEY NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "content" text NOT NULL,
  "subjects" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL,
  "embedding" vector(768),
  "embedding_status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "event_projections_agent_time_idx" ON "event_projections" ("agent_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "event_projections_embedding_status_idx" ON "event_projections" ("embedding_status","agent_id");
--> statement-breakpoint
INSERT INTO "event_projections" ("event_id","agent_id","kind","content","subjects","occurred_at")
SELECT e.id,e.agent_id,e.kind,
  left(COALESCE(e.observation->>'summary',e.observation::text),4000),
  CASE WHEN jsonb_typeof(e.observation #> '{actor,id}')='string' THEN jsonb_build_array(e.observation #> '{actor,id}') ELSE '[]'::jsonb END,
  e.occurred_at
FROM "events" e
WHERE e.kind <> 'tool-result'
ON CONFLICT ("event_id") DO NOTHING;
