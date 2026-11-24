CREATE TABLE "app"."concern_reevaluation_signal_sources" (
	"agent_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concern_reevaluation_signal_sources_agent_id_source_kind_source_id_pk" PRIMARY KEY("agent_id","source_kind","source_id")
);
--> statement-breakpoint
CREATE TABLE "app"."concern_reevaluation_signals" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "app"."concerns_agent_reconsider_idx";--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_signal_sources" ADD CONSTRAINT "concern_reevaluation_signal_sources_agent_id_concern_reevaluation_signals_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."concern_reevaluation_signals"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."concern_reevaluation_signals" ADD CONSTRAINT "concern_reevaluation_signals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concern_reevaluation_signals_due_idx" ON "app"."concern_reevaluation_signals" USING btree ("next_due_at","lease_until");--> statement-breakpoint
ALTER TABLE "app"."concerns" DROP COLUMN "reconsider_at";