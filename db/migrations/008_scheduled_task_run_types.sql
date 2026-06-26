ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_run_type_check;

ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_run_type_check CHECK (run_type IN (
    'creator_video_sync',
    'creator_profile_sync',
    'bilibili_auth_check',
    'video_processing',
    'video_asr_retry',
    'video_ai_retry',
    'poi_match',
    'scheduled_ai_runs_cleanup',
    'scheduled_task_logs_cleanup'
  ));
