CREATE TABLE "app"."conversation_goal_compositions" (
	"event_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"source" text NOT NULL,
	"input" jsonb,
	"reason" text NOT NULL,
	"goal" text,
	"model_calls" integer NOT NULL,
	"retrieval_count" integer NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_goal_compositions_source_check" CHECK ("app"."conversation_goal_compositions"."source" IN ('observed','direct','peer-initiation'))
);
--> statement-breakpoint
ALTER TABLE "app"."conversation_goal_compositions" ADD CONSTRAINT "conversation_goal_compositions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversation_goal_compositions" ADD CONSTRAINT "conversation_goal_compositions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_goal_compositions_agent_created_idx" ON "app"."conversation_goal_compositions" USING btree ("agent_id","created_at");