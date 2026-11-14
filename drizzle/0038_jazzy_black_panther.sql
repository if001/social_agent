CREATE TABLE "app"."reflection_tool_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"reflection_id" text NOT NULL,
	"target" text NOT NULL,
	"batch_index" integer,
	"anchor_memory_id" text,
	"execution_index" integer NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflection_tool_executions_target_check" CHECK ("app"."reflection_tool_executions"."target" IN ('memory', 'reconciliation', 'concern', 'relationship', 'self-mood'))
);
--> statement-breakpoint
ALTER TABLE "app"."reflection_tool_executions" ADD CONSTRAINT "reflection_tool_executions_reflection_id_reflection_runs_id_fk" FOREIGN KEY ("reflection_id") REFERENCES "app"."reflection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reflection_tool_executions_reflection_scope_idx" ON "app"."reflection_tool_executions" USING btree ("reflection_id","target","batch_index","anchor_memory_id","execution_index");