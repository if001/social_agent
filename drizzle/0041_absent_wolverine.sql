CREATE TABLE "app"."observation_gate_decisions" (
	"event_id" text PRIMARY KEY NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"model_calls" integer NOT NULL,
	"retrieval_count" integer NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observation_gate_decisions_decision_check" CHECK ("app"."observation_gate_decisions"."decision" IN ('ignore', 'engage'))
);
--> statement-breakpoint
ALTER TABLE "app"."observation_gate_decisions" ADD CONSTRAINT "observation_gate_decisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE cascade ON UPDATE no action;