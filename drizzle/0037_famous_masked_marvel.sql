CREATE TABLE "app"."event_subjects" (
	"event_id" text NOT NULL,
	"subject_id" text NOT NULL,
	CONSTRAINT "event_subjects_event_id_subject_id_pk" PRIMARY KEY("event_id","subject_id")
);
--> statement-breakpoint
DROP INDEX "app"."event_experiences_agent_time_idx";--> statement-breakpoint
DROP INDEX "app"."event_projections_agent_time_idx";--> statement-breakpoint
DROP INDEX "app"."experience_integrations_agent_created_idx";--> statement-breakpoint
DROP INDEX "app"."event_projections_embedding_status_idx";--> statement-breakpoint
DROP INDEX "app"."experience_integrations_source_run_uidx";--> statement-breakpoint
ALTER TABLE "app"."event_experiences" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_experiences" ALTER COLUMN "subjects" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app"."event_experiences" ALTER COLUMN "subjects" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_experiences" ALTER COLUMN "occurred_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ALTER COLUMN "subjects" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ALTER COLUMN "subjects" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ALTER COLUMN "occurred_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."experience_integrations" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."experience_integrations" ALTER COLUMN "source_event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."experience_integrations" ALTER COLUMN "input" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."scheduled_tasks" ALTER COLUMN "source_event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tool_executions" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."web_snapshots" ALTER COLUMN "source_event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ADD COLUMN "embedding_dimension" integer;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ADD COLUMN "embedding_error" text;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ADD COLUMN "embedding_last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."event_projections" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."event_subjects" ADD CONSTRAINT "event_subjects_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_subjects_subject_idx" ON "app"."event_subjects" USING btree ("subject_id","event_id");--> statement-breakpoint
CREATE INDEX "experience_integrations_status_created_idx" ON "app"."experience_integrations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "event_projections_embedding_status_idx" ON "app"."event_projections" USING btree ("embedding_status");--> statement-breakpoint
CREATE UNIQUE INDEX "experience_integrations_source_run_uidx" ON "app"."experience_integrations" USING btree ("source_run_id");