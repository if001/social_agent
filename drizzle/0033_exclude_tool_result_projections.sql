DELETE FROM "event_projections" p
USING "events" e
WHERE e.id=p.event_id
  AND e.kind='tool-result';
