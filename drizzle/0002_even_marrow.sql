ALTER TABLE "post_process_jobs" DROP CONSTRAINT "post_process_jobs_interaction_run_id_unique";--> statement-breakpoint
TRUNCATE TABLE "post_process_jobs";--> statement-breakpoint
ALTER TABLE "post_process_jobs" ADD COLUMN "job_type" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "post_process_jobs_run_type_uidx" ON "post_process_jobs" USING btree ("interaction_run_id","job_type");
