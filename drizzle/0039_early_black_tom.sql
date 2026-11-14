ALTER TABLE "app"."reflection_attempts" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reflection_attempts" ALTER COLUMN "tool_executions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app"."reflection_attempts" ALTER COLUMN "tool_executions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reflection_memory_batches" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reflection_memory_batches" ALTER COLUMN "tool_executions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app"."reflection_memory_batches" ALTER COLUMN "tool_executions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reflection_resolutions" ALTER COLUMN "agent_id" DROP NOT NULL;