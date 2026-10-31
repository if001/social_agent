CREATE TABLE "memory_mutations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"memory_id" text,
	"operation" text NOT NULL,
	"candidate_memory_id" text,
	"source_event_id" text,
	"intent_index" integer,
	"source_agent_id" text,
	"intent" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_mutations" ADD CONSTRAINT "memory_mutations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_mutations_agent_created_idx" ON "memory_mutations" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_mutations_event_intent_uidx" ON "memory_mutations" USING btree ("agent_id","source_event_id","intent_index");