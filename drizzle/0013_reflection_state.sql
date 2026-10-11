CREATE TABLE "reflection_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"input_state_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"failure_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_states" ADD COLUMN "disposition" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_states" ADD COLUMN "self_story" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_states" ADD COLUMN "commitments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_states" ADD COLUMN "concerns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_states" ADD COLUMN "relationships" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reflection_runs" ADD CONSTRAINT "reflection_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reflection_runs_agent_status_idx" ON "reflection_runs" USING btree ("agent_id","status","created_at");--> statement-breakpoint
UPDATE agent_states s
SET disposition = concat_ws(E'\n', NULLIF(s.values, ''), NULLIF(s.acquired_disposition, '')),
    self_story = concat_ws(E'\n', NULLIF(s.self_narrative, ''), NULLIF(s.self_continuity, '')),
    commitments = CASE
      WHEN s.raison_detre IS NULL OR btrim(s.raison_detre) = '' THEN s.roles
      ELSE s.roles || jsonb_build_array(s.raison_detre)
    END,
    concerns = COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', motive->>'id',
        'description', motive->>'description',
        'whyItMatters', COALESCE(motive->>'considerationReason', motive->>'description'),
        'status', 'active',
        'reconsiderAt', motive->>'nextConsiderAt'
      )))
      FROM jsonb_array_elements(s.motives) motive
      WHERE motive ? 'id' AND motive ? 'description'
    ), '[]'::jsonb),
    relationships = COALESCE((
      SELECT jsonb_agg(jsonb_build_object('subjectId', c.subject_id, 'description', c.description) ORDER BY c.subject_id)
      FROM social_contexts c WHERE c.agent_id = s.agent_id
    ), '[]'::jsonb);
