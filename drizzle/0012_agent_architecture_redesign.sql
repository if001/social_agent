-- Custom SQL migration file, put your code below! --
INSERT INTO autonomous_schedules (id, agent_id, kind, reason, next_due_at, lease_until, updated_at)
SELECT 'idle:' || agent_id, agent_id, 'idle',
       '一定期間の無活動を契機に、現在のSelf、State、Memoryから行動を検討する',
       next_due_at, NULL, now()
FROM autonomous_schedules
WHERE kind = 'autonomy-review'
ON CONFLICT (id) DO UPDATE
SET kind = 'idle', reason = EXCLUDED.reason,
    next_due_at = LEAST(autonomous_schedules.next_due_at, EXCLUDED.next_due_at),
    lease_until = NULL, updated_at = now();

INSERT INTO autonomous_schedules (id, agent_id, kind, reason, next_due_at, lease_until, updated_at)
SELECT 'concern:' || regexp_replace(id, '^motive:', ''), agent_id, 'concern-due', reason,
       next_due_at, NULL, now()
FROM autonomous_schedules
WHERE kind = 'motive-review'
ON CONFLICT (id) DO UPDATE
SET kind = 'concern-due', reason = EXCLUDED.reason,
    next_due_at = LEAST(autonomous_schedules.next_due_at, EXCLUDED.next_due_at),
    lease_until = NULL, updated_at = now();

DELETE FROM autonomous_schedules
WHERE kind IN ('autonomy-review', 'motive-review', 'state-review', 'memory-recall');

UPDATE post_process_jobs
SET status = 'failed', lease_until = NULL,
    failure_reason = 'Superseded by event-driven reflection architecture', updated_at = now()
WHERE status IN ('pending', 'processing');
