ALTER TABLE "app"."concern_activities" ADD COLUMN "source_concern_id" text;--> statement-breakpoint
ALTER TABLE "app"."concern_activities" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "app"."concern_activities" ADD CONSTRAINT "concern_activities_source_concern_id_concerns_id_fk" FOREIGN KEY ("source_concern_id") REFERENCES "app"."concerns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concern_activities_source_concern_idx" ON "app"."concern_activities" USING btree ("source_concern_id");