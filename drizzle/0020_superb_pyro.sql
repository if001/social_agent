CREATE TABLE "background_experiences" (
	"id" text NOT NULL,
	"agent_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"age" integer NOT NULL,
	"place" text NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relationship" text NOT NULL,
	"action" text NOT NULL,
	"feeling" text NOT NULL,
	"outcome" text NOT NULL,
	"lesson" text NOT NULL,
	"importance" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	"embedding_dimension" integer,
	"embedding_status" text DEFAULT 'pending' NOT NULL,
	"embedding_error" text,
	"embedding_last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_experiences_agent_id_id_pk" PRIMARY KEY("agent_id","id")
);
--> statement-breakpoint
ALTER TABLE "background_experiences" ADD CONSTRAINT "background_experiences_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_experiences_agent_time_idx" ON "background_experiences" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "background_experiences_embedding_status_idx" ON "background_experiences" USING btree ("embedding_status","agent_id");