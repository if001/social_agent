UPDATE "agent_states"
SET "current_interests" = COALESCE((
  SELECT jsonb_agg(
    (entry.value - 'question') || jsonb_build_object('focus', entry.value->'question')
    ORDER BY entry.ordinality
  )
  FROM jsonb_array_elements("agent_states"."current_interests") WITH ORDINALITY AS entry(value, ordinality)
), '[]'::jsonb)
WHERE jsonb_typeof("current_interests") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("current_interests") AS item
    WHERE item ? 'question'
  );
--> statement-breakpoint
UPDATE "post_process_jobs"
SET "payload" = jsonb_set(
  "payload",
  '{dynamicState,currentInterests}',
  COALESCE((
    SELECT jsonb_agg(
      (entry.value - 'question') || jsonb_build_object('focus', entry.value->'question')
      ORDER BY entry.ordinality
    )
    FROM jsonb_array_elements("post_process_jobs"."payload"#>'{dynamicState,currentInterests}') WITH ORDINALITY AS entry(value, ordinality)
  ), '[]'::jsonb)
)
WHERE jsonb_typeof("payload"#>'{dynamicState,currentInterests}') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("payload"#>'{dynamicState,currentInterests}') AS item
    WHERE item ? 'question'
  );
