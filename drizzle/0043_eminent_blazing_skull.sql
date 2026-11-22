CREATE TABLE "app"."concerns" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"description" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"status" text NOT NULL,
	"reconsider_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."concerns" ADD CONSTRAINT "concerns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concerns_agent_status_idx" ON "app"."concerns" USING btree ("agent_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "concerns_agent_reconsider_idx" ON "app"."concerns" USING btree ("agent_id","reconsider_at");