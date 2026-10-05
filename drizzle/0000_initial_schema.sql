CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "agent_lock_keys" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"lock_key" bigint NOT NULL,
	CONSTRAINT "agent_lock_keys_lock_key_unique" UNIQUE("lock_key")
);
--> statement-breakpoint
CREATE TABLE "agent_families" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"shared_disposition" text NOT NULL,
	"base_instruction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"event_id" text NOT NULL,
	"input_state_version" integer NOT NULL,
	"result" jsonb,
	"failure_reason" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_states" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"acquired_disposition" text NOT NULL,
	"values" text NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raison_detre" text,
	"self_narrative" text NOT NULL,
	"self_continuity" text NOT NULL,
	"mood" text NOT NULL,
	"drives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"identity" text NOT NULL,
	"initial_disposition" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autonomous_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_evidence" (
	"candidate_id" text NOT NULL,
	"memory_id" text NOT NULL,
	CONSTRAINT "candidate_evidence_candidate_id_memory_id_pk" PRIMARY KEY("candidate_id","memory_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"observation" jsonb NOT NULL,
	"source" text NOT NULL,
	"correlation_id" text,
	"causation_id" text,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intentions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"description" text NOT NULL,
	"reason" text NOT NULL,
	"trigger" jsonb,
	"status" text NOT NULL,
	"next_review_at" timestamp with time zone,
	"superseded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "long_term_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"target" text NOT NULL,
	"proposed_value" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_after" timestamp with time zone,
	"review_lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"importance" text NOT NULL,
	"retrieval_priority" text DEFAULT 'normal' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	"embedding_dimension" integer,
	"embedding_status" text DEFAULT 'pending' NOT NULL,
	"embedding_error" text,
	"embedding_last_attempt_at" timestamp with time zone,
	"source_agent_id" text,
	"evidence_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_intentions" (
	"memory_id" text NOT NULL,
	"intention_id" text NOT NULL,
	CONSTRAINT "memory_intentions_memory_id_intention_id_pk" PRIMARY KEY("memory_id","intention_id")
);
--> statement-breakpoint
CREATE TABLE "memory_subjects" (
	"memory_id" text NOT NULL,
	"subject_id" text NOT NULL,
	CONSTRAINT "memory_subjects_memory_id_subject_id_pk" PRIMARY KEY("memory_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "memory_web_evidence" (
	"memory_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	CONSTRAINT "memory_web_evidence_memory_id_snapshot_id_pk" PRIMARY KEY("memory_id","snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "message_receipts" (
	"destination" text NOT NULL,
	"message_id" text NOT NULL,
	"status" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_receipts_destination_message_id_pk" PRIMARY KEY("destination","message_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_correlations" (
	"agent_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_correlations_agent_id_correlation_id_pk" PRIMARY KEY("agent_id","correlation_id")
);
--> statement-breakpoint
CREATE TABLE "runtime_rate_windows" (
	"agent_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"event_count" integer NOT NULL,
	CONSTRAINT "runtime_rate_windows_agent_id_window_start_pk" PRIMARY KEY("agent_id","window_start")
);
--> statement-breakpoint
CREATE TABLE "social_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"target" text NOT NULL,
	"operation" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"event_id" text NOT NULL,
	"result_event_id" text,
	"tool_call_id" text NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_url" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_resources_canonical_url_unique" UNIQUE("canonical_url")
);
--> statement-breakpoint
CREATE TABLE "web_snapshot_chunks" (
	"snapshot_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	"embedding_dimension" integer,
	CONSTRAINT "web_snapshot_chunks_snapshot_id_chunk_index_pk" PRIMARY KEY("snapshot_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "web_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"fetched_url" text NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"summary" text NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	"embedding_dimension" integer,
	"embedding_error" text,
	"embedding_last_attempt_at" timestamp with time zone,
	"source_run_id" text NOT NULL,
	"source_tool_call_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"tool_result_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Keep references unqualified so the same generated migration works in the configured PostgreSQL schema and isolated test schemas.
ALTER TABLE "agent_lock_keys" ADD CONSTRAINT "agent_lock_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_states" ADD CONSTRAINT "agent_states_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_family_id_agent_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "agent_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomous_schedules" ADD CONSTRAINT "autonomous_schedules_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_evidence" ADD CONSTRAINT "candidate_evidence_candidate_id_long_term_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "long_term_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_evidence" ADD CONSTRAINT "candidate_evidence_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intentions" ADD CONSTRAINT "intentions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "long_term_candidates" ADD CONSTRAINT "long_term_candidates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_intentions" ADD CONSTRAINT "memory_intentions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_intentions" ADD CONSTRAINT "memory_intentions_intention_id_intentions_id_fk" FOREIGN KEY ("intention_id") REFERENCES "intentions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_subjects" ADD CONSTRAINT "memory_subjects_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_web_evidence" ADD CONSTRAINT "memory_web_evidence_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_web_evidence" ADD CONSTRAINT "memory_web_evidence_snapshot_id_web_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "web_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_correlations" ADD CONSTRAINT "runtime_correlations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_rate_windows" ADD CONSTRAINT "runtime_rate_windows_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_contexts" ADD CONSTRAINT "social_contexts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_result_event_id_events_id_fk" FOREIGN KEY ("result_event_id") REFERENCES "events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_snapshot_chunks" ADD CONSTRAINT "web_snapshot_chunks_snapshot_id_web_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "web_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_snapshots" ADD CONSTRAINT "web_snapshots_resource_id_web_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "web_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_snapshots" ADD CONSTRAINT "web_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_family_idx" ON "agents" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "autonomous_schedules_due_idx" ON "autonomous_schedules" USING btree ("next_due_at","lease_until","agent_id");--> statement-breakpoint
CREATE INDEX "intentions_agent_status_idx" ON "intentions" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "long_term_candidates_review_due_idx" ON "long_term_candidates" USING btree ("status","review_after","review_lease_until");--> statement-breakpoint
CREATE INDEX "memories_agent_kind_idx" ON "memories" USING btree ("agent_id","kind");--> statement-breakpoint
CREATE INDEX "memories_embedding_status_idx" ON "memories" USING btree ("embedding_status","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_context_owner_subject_uidx" ON "social_contexts" USING btree ("agent_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_execution_idempotency_uidx" ON "tool_executions" USING btree ("run_id","tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_snapshot_agent_resource_hash_uidx" ON "web_snapshots" USING btree ("agent_id","resource_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "web_snapshot_tool_fetch_uidx" ON "web_snapshots" USING btree ("agent_id","source_run_id","source_tool_call_id","fetched_url");--> statement-breakpoint
CREATE INDEX "web_snapshots_agent_fetched_idx" ON "web_snapshots" USING btree ("agent_id","fetched_at");
