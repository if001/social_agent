DELETE FROM post_process_jobs memory_job
USING post_process_jobs continuity_job
WHERE memory_job.interaction_run_id = continuity_job.interaction_run_id
  AND memory_job.job_type = 'memory'
  AND continuity_job.job_type = 'continuity';

UPDATE post_process_jobs
SET job_type = 'experience-integration', status = 'pending', lease_until = NULL,
    failure_reason = NULL, available_at = now(), updated_at = now()
WHERE job_type IN ('continuity', 'memory');
