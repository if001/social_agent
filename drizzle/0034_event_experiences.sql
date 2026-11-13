CREATE TABLE "event_experiences" (
  "event_id" text PRIMARY KEY NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "integration_id" text REFERENCES "experience_integrations"("id") ON DELETE CASCADE,
  "summary" text NOT NULL,
  "facts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "subjects" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "event_experiences_agent_time_idx" ON "event_experiences" ("agent_id","occurred_at");
--> statement-breakpoint
DELETE FROM "event_projections";
--> statement-breakpoint
INSERT INTO "event_experiences" ("event_id","agent_id","summary","facts","subjects","occurred_at")
SELECT e.id,e.agent_id,e.observation->>'summary',
  COALESCE(e.observation->'facts','[]'::jsonb),
  CASE WHEN jsonb_typeof(e.observation #> '{actor,id}')='string' THEN jsonb_build_array(e.observation #> '{actor,id}') ELSE '[]'::jsonb END,
  e.occurred_at
FROM "events" e
WHERE e.status='completed'
  AND e.kind<>'tool-result'
  AND e.observation->>'summary' IS NOT NULL
  AND COALESCE((e.observation->'content'->>'schedulerGenerated')::boolean,false)=false
ON CONFLICT ("event_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "event_projections" ("event_id","agent_id","kind","content","subjects","occurred_at")
SELECT x.event_id,x.agent_id,e.kind,x.summary,x.subjects,x.occurred_at
FROM "event_experiences" x JOIN "events" e ON e.id=x.event_id
ON CONFLICT ("event_id") DO NOTHING;
