ALTER TABLE "app"."concern_activities" DROP CONSTRAINT "concern_activities_agent_id_fkey";
--> statement-breakpoint
DROP INDEX "app"."concern_activities_agent_concern_occurred_idx";--> statement-breakpoint
DROP INDEX "app"."concern_activities_agent_reflection_idx";--> statement-breakpoint
ALTER TABLE "app"."concern_activities" ADD CONSTRAINT "concern_activities_concern_id_concerns_id_fk" FOREIGN KEY ("concern_id") REFERENCES "app"."concerns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concern_activities_concern_occurred_idx" ON "app"."concern_activities" USING btree ("concern_id","occurred_at");--> statement-breakpoint
CREATE INDEX "concern_activities_reflection_idx" ON "app"."concern_activities" USING btree ("reflection_id");--> statement-breakpoint
ALTER TABLE "app"."agent_states" DROP COLUMN "concerns";--> statement-breakpoint
ALTER TABLE "app"."concern_activities" DROP COLUMN "agent_id";