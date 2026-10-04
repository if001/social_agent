CREATE EXTENSION IF NOT EXISTS vector;

-- Drizzle schema is the source of truth. This migration is intentionally
-- idempotent so an interrupted deployment can safely re-run it.
CREATE TABLE IF NOT EXISTS agent_families (id text PRIMARY KEY, name text NOT NULL, shared_disposition text NOT NULL, capabilities jsonb NOT NULL, base_instruction text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, family_id text NOT NULL REFERENCES agent_families(id), identity text NOT NULL, initial_disposition text NOT NULL, config jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS agents_family_idx ON agents(family_id);
CREATE TABLE IF NOT EXISTS agent_states (agent_id text PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE, acquired_disposition text NOT NULL, values text NOT NULL, role text NOT NULL, self_narrative text NOT NULL, self_continuity text NOT NULL, mood text NOT NULL, version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS interests jsonb NOT NULL DEFAULT '[]';
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '[]';
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS roles jsonb NOT NULL DEFAULT '[]';
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS raison_detre text;
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS drives jsonb NOT NULL DEFAULT '[]';
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS current_interests jsonb NOT NULL DEFAULT '[]';
UPDATE agent_states SET roles=jsonb_build_array(role) WHERE roles='[]'::jsonb AND btrim(role)<>'';
ALTER TABLE agent_states DROP COLUMN IF EXISTS emotion;
ALTER TABLE agent_states DROP COLUMN IF EXISTS desire;
ALTER TABLE agent_states DROP COLUMN IF EXISTS desires;
ALTER TABLE agent_states DROP COLUMN IF EXISTS drive;
UPDATE agent_states SET drives=COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(item)='string' THEN jsonb_build_object('description',item #>> '{}','sourceEvidenceIds','[]'::jsonb,'since',to_jsonb(agent_states.updated_at)) ELSE item END) FROM jsonb_array_elements(agent_states.drives) item),'[]'::jsonb)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(agent_states.drives) item WHERE jsonb_typeof(item)='string');
CREATE TABLE IF NOT EXISTS social_contexts (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, subject_id text NOT NULL, subject_type text NOT NULL CHECK(subject_type IN ('user','agent','team','project','organization')), description text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(agent_id, subject_id));
ALTER TABLE social_contexts ADD COLUMN IF NOT EXISTS subject_type text;
UPDATE social_contexts SET subject_type='user' WHERE subject_type IS NULL;
ALTER TABLE social_contexts ALTER COLUMN subject_type SET NOT NULL;
ALTER TABLE social_contexts DROP CONSTRAINT IF EXISTS social_contexts_subject_type_check;
ALTER TABLE social_contexts ADD CONSTRAINT social_contexts_subject_type_check CHECK(subject_type IN ('user','agent','team','project','organization'));
CREATE TABLE IF NOT EXISTS intentions (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, description text NOT NULL, reason text NOT NULL, trigger jsonb, status text NOT NULL CHECK(status IN ('active','completed','dropped','superseded')), next_review_at timestamptz, superseded_by_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS intentions_agent_status_idx ON intentions(agent_id,status);
CREATE TABLE IF NOT EXISTS autonomous_schedules (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, kind text NOT NULL, reason text NOT NULL, next_due_at timestamptz NOT NULL, lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS autonomous_schedules_due_idx ON autonomous_schedules(next_due_at,lease_until,agent_id);
INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at)
SELECT 'state-review:' || id,id,'state-review','時間経過によるMood、Drive、Current Interestの再評価',now()+interval '1 day' FROM agents
ON CONFLICT (id) DO NOTHING;
INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at)
SELECT 'memory-recall:' || id,id,'memory-recall','現在の状態と未完了Intentionに関連するMemoryの再検討',now()+interval '7 days' FROM agents
ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS memories (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, kind text NOT NULL, content text NOT NULL, importance text NOT NULL, occurred_at timestamptz NOT NULL, embedding vector(768), embedding_model text, source_agent_id text, evidence_event_ids jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_dimension integer;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_status text NOT NULL DEFAULT 'pending';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_error text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_last_attempt_at timestamptz;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS retrieval_priority text NOT NULL DEFAULT 'normal';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS evidence_memory_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_embedding_status_check;
ALTER TABLE memories ADD CONSTRAINT memories_embedding_status_check CHECK(embedding_status IN ('pending','ready','failed'));
ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_retrieval_priority_check;
ALTER TABLE memories ADD CONSTRAINT memories_retrieval_priority_check CHECK(retrieval_priority IN ('low','normal','high','critical'));
UPDATE memories SET embedding_status='ready',embedding_dimension=COALESCE(embedding_dimension,768) WHERE embedding IS NOT NULL AND embedding_status<>'ready';
CREATE INDEX IF NOT EXISTS memories_embedding_status_idx ON memories(embedding_status,agent_id);
CREATE INDEX IF NOT EXISTS memories_agent_kind_idx ON memories(agent_id,kind);
CREATE INDEX IF NOT EXISTS memories_content_fts_idx ON memories USING gin(to_tsvector('simple',content));
CREATE TABLE IF NOT EXISTS memory_subjects (memory_id text NOT NULL REFERENCES memories(id) ON DELETE CASCADE, subject_id text NOT NULL, PRIMARY KEY(memory_id,subject_id));
CREATE TABLE IF NOT EXISTS memory_intentions (memory_id text NOT NULL REFERENCES memories(id) ON DELETE CASCADE, intention_id text NOT NULL REFERENCES intentions(id) ON DELETE CASCADE, PRIMARY KEY(memory_id,intention_id));
CREATE TABLE IF NOT EXISTS web_resources (id text PRIMARY KEY, canonical_url text NOT NULL UNIQUE, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS web_snapshots (id text PRIMARY KEY, resource_id text NOT NULL REFERENCES web_resources(id) ON DELETE CASCADE, agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, fetched_url text NOT NULL, title text NOT NULL, raw_text text NOT NULL, summary text NOT NULL, content_hash text NOT NULL, fetched_at timestamptz NOT NULL, processing_status text NOT NULL DEFAULT 'pending', embedding vector(768), embedding_model text, embedding_dimension integer, embedding_error text, embedding_last_attempt_at timestamptz, source_run_id text NOT NULL, source_tool_call_id text NOT NULL, source_event_id text NOT NULL, tool_result_event_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(agent_id,resource_id,content_hash), UNIQUE(agent_id,source_run_id,source_tool_call_id,fetched_url));
CREATE INDEX IF NOT EXISTS web_snapshots_agent_fetched_idx ON web_snapshots(agent_id,fetched_at DESC);
CREATE INDEX IF NOT EXISTS web_snapshots_content_fts_idx ON web_snapshots USING gin(to_tsvector('simple',summary || ' ' || title || ' ' || raw_text));
CREATE TABLE IF NOT EXISTS web_snapshot_chunks (snapshot_id text NOT NULL REFERENCES web_snapshots(id) ON DELETE CASCADE, chunk_index integer NOT NULL, text text NOT NULL, embedding vector(768), embedding_model text, embedding_dimension integer, PRIMARY KEY(snapshot_id,chunk_index));
CREATE TABLE IF NOT EXISTS memory_web_evidence (memory_id text NOT NULL REFERENCES memories(id) ON DELETE CASCADE, snapshot_id text NOT NULL REFERENCES web_snapshots(id) ON DELETE CASCADE, PRIMARY KEY(memory_id,snapshot_id));
CREATE TABLE IF NOT EXISTS long_term_candidates (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, target text NOT NULL, proposed_value text NOT NULL, status text NOT NULL, reason text NOT NULL, review_after timestamptz, review_lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE long_term_candidates ADD COLUMN IF NOT EXISTS evidence_event_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE long_term_candidates ADD COLUMN IF NOT EXISTS review_after timestamptz;
ALTER TABLE long_term_candidates ADD COLUMN IF NOT EXISTS review_lease_until timestamptz;
CREATE INDEX IF NOT EXISTS long_term_candidates_review_due_idx ON long_term_candidates(status,review_after,review_lease_until);
CREATE TABLE IF NOT EXISTS candidate_evidence (candidate_id text NOT NULL REFERENCES long_term_candidates(id) ON DELETE CASCADE, memory_id text NOT NULL REFERENCES memories(id) ON DELETE CASCADE, PRIMARY KEY(candidate_id,memory_id));
CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), kind text NOT NULL, observation jsonb NOT NULL, source text NOT NULL, correlation_id text, status text NOT NULL, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE events ADD COLUMN IF NOT EXISTS causation_id text;
CREATE TABLE IF NOT EXISTS agent_runs (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), event_id text NOT NULL REFERENCES events(id), input_state_version integer NOT NULL, result jsonb, failure_reason text, started_at timestamptz NOT NULL, finished_at timestamptz);
CREATE TABLE IF NOT EXISTS state_changes (id text PRIMARY KEY, run_id text NOT NULL REFERENCES agent_runs(id), target text NOT NULL, operation text NOT NULL, before jsonb, after jsonb, reason text NOT NULL, evidence_ids jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tool_executions (id text PRIMARY KEY, run_id text NOT NULL REFERENCES agent_runs(id), event_id text NOT NULL REFERENCES events(id), tool_call_id text NOT NULL, tool text NOT NULL, input jsonb NOT NULL, result jsonb, error text, started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,tool_call_id));
ALTER TABLE tool_executions ADD COLUMN IF NOT EXISTS event_id text REFERENCES events(id);
ALTER TABLE tool_executions ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE tool_executions ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE tool_executions ADD COLUMN IF NOT EXISTS result_event_id text REFERENCES events(id);
UPDATE tool_executions t SET event_id=r.event_id FROM agent_runs r WHERE t.run_id=r.id AND t.event_id IS NULL;
UPDATE tool_executions SET started_at=created_at WHERE started_at IS NULL;
UPDATE tool_executions SET finished_at=created_at WHERE finished_at IS NULL;
ALTER TABLE tool_executions ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE tool_executions ALTER COLUMN started_at SET NOT NULL;
ALTER TABLE tool_executions ALTER COLUMN finished_at SET NOT NULL;
CREATE TABLE IF NOT EXISTS message_receipts (destination text NOT NULL, message_id text NOT NULL, status text NOT NULL, processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(destination,message_id));
CREATE TABLE IF NOT EXISTS outbox_messages (id text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), envelope jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', attempt integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_lock_keys (agent_id text PRIMARY KEY REFERENCES agents(id), lock_key bigint NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS runtime_correlations (agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, correlation_id text NOT NULL, message_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(agent_id,correlation_id));
CREATE TABLE IF NOT EXISTS runtime_rate_windows (agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE, window_start timestamptz NOT NULL, event_count integer NOT NULL, PRIMARY KEY(agent_id,window_start));
