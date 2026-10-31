CREATE TABLE "prediction_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"prediction_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"group" text NOT NULL,
	"candidate_index" integer NOT NULL,
	"match" text NOT NULL,
	"surprise" text NOT NULL,
	"difference" text NOT NULL,
	"interpretation" text NOT NULL,
	"uncertainty" text NOT NULL,
	"attribution" text,
	"observed" text NOT NULL,
	"error_direction" text NOT NULL,
	"effect" text NOT NULL,
	"effect_evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_records" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"source_run_id" text NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prediction_evaluations" ADD CONSTRAINT "prediction_evaluations_prediction_id_prediction_records_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "prediction_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_evaluations" ADD CONSTRAINT "prediction_evaluations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_records" ADD CONSTRAINT "prediction_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prediction_evaluations_agent_created_idx" ON "prediction_evaluations" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "prediction_records_agent_created_idx" ON "prediction_records" USING btree ("agent_id","created_at");