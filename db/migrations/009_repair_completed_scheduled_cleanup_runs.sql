UPDATE pipeline_runs pr
SET status = 'success',
    finished_at = COALESCE(
      pr.finished_at,
      (
        SELECT MAX(pe.created_at)
        FROM pipeline_events pe
        WHERE pe.run_id = pr.id
          AND pe.event_type = 'completed'
          AND pe.level = 'success'
      )
    ),
    updated_at = now()
WHERE pr.status = 'running'
  AND pr.run_type IN ('scheduled_ai_runs_cleanup', 'scheduled_task_logs_cleanup')
  AND EXISTS (
    SELECT 1
    FROM pipeline_events pe
    WHERE pe.run_id = pr.id
      AND pe.event_type = 'completed'
      AND pe.level = 'success'
  );

UPDATE jobs j
SET status = 'success',
    finished_at = COALESCE(
      j.finished_at,
      (
        SELECT MAX(pe.created_at)
        FROM pipeline_events pe
        WHERE pe.job_id = j.id
          AND pe.event_type = 'completed'
          AND pe.level = 'success'
      )
    ),
    updated_at = now()
WHERE j.status = 'running'
  AND j.job_type IN ('cleanup_ai_runs', 'cleanup_task_logs')
  AND EXISTS (
    SELECT 1
    FROM pipeline_events pe
    WHERE pe.job_id = j.id
      AND pe.event_type = 'completed'
      AND pe.level = 'success'
  );
