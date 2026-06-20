ALTER TABLE pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_run_type_check;
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_run_type_check CHECK (
  run_type IN (
    'creator_video_sync',
    'creator_profile_sync',
    'bilibili_auth_check',
    'video_processing',
    'video_asr_retry',
    'video_ai_retry',
    'poi_match'
  )
);

CREATE OR REPLACE FUNCTION notify_admin_task_event()
RETURNS trigger AS $$
DECLARE
  payload json;
BEGIN
  IF TG_TABLE_NAME = 'pipeline_runs' THEN
    payload = json_build_object(
      'type', CASE WHEN TG_OP = 'INSERT' THEN 'run.created' ELSE 'run.updated' END,
      'run_id', NEW.id,
      'run_type', NEW.run_type,
      'entity_type', NEW.entity_type,
      'entity_id', NEW.entity_id,
      'status', NEW.status,
      'updated_at', NEW.updated_at
    );
  ELSE
    payload = json_build_object(
      'type', 'pipeline.event',
      'event_id', NEW.id,
      'run_id', NEW.run_id,
      'entity_type', NEW.entity_type,
      'entity_id', NEW.entity_id,
      'stage', NEW.stage,
      'event_type', NEW.event_type,
      'level', NEW.level,
      'progress_percent', NEW.progress_percent,
      'created_at', NEW.created_at
    );
  END IF;
  PERFORM pg_notify('gowith_admin_tasks', payload::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pipeline_runs_insert_notify_admin_task ON pipeline_runs;
CREATE TRIGGER pipeline_runs_insert_notify_admin_task
AFTER INSERT ON pipeline_runs
FOR EACH ROW EXECUTE FUNCTION notify_admin_task_event();

DROP TRIGGER IF EXISTS pipeline_runs_update_notify_admin_task ON pipeline_runs;
CREATE TRIGGER pipeline_runs_update_notify_admin_task
AFTER UPDATE OF status ON pipeline_runs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION notify_admin_task_event();

DROP TRIGGER IF EXISTS pipeline_events_notify_admin_task ON pipeline_events;
CREATE TRIGGER pipeline_events_notify_admin_task
AFTER INSERT ON pipeline_events
FOR EACH ROW EXECUTE FUNCTION notify_admin_task_event();
