-- Custom SQL migration file, put your code below! --
INSERT INTO autonomous_schedules(id, agent_id, kind, reason, next_due_at)
SELECT 'reflection:' || id, id, 'reflection',
       '蓄積したEvent logをMemoryと長期状態へ統合する',
       now() + interval '1 day'
FROM agents
WHERE active = true
ON CONFLICT (id) DO NOTHING;
