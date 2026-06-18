CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('creator_video_sync', 'video_processing', 'video_asr_retry', 'video_ai_retry', 'poi_match')),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  triggered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_runs_entity_idx ON pipeline_runs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_runs_status_idx ON pipeline_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_runs_type_idx ON pipeline_runs (run_type, created_at DESC);

DROP TRIGGER IF EXISTS pipeline_runs_set_updated_at ON pipeline_runs;
CREATE TRIGGER pipeline_runs_set_updated_at BEFORE UPDATE ON pipeline_runs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  stage text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('queued', 'started', 'progress', 'ai_request_prepared', 'ai_response_validated', 'saved', 'skipped', 'failed', 'completed')),
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error')),
  title text NOT NULL,
  message text,
  progress_percent numeric(5,2),
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_events_run_idx ON pipeline_events (run_id, created_at);
CREATE INDEX IF NOT EXISTS pipeline_events_entity_idx ON pipeline_events (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_events_stage_idx ON pipeline_events (stage, event_type, created_at DESC);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES pipeline_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS jobs_run_idx ON jobs (run_id, created_at DESC);
