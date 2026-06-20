ALTER TABLE ai_runs
  ADD COLUMN IF NOT EXISTS parent_ai_run_id uuid REFERENCES ai_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS call_index integer;

CREATE INDEX IF NOT EXISTS ai_runs_parent_idx
  ON ai_runs (parent_ai_run_id, call_index)
  WHERE parent_ai_run_id IS NOT NULL;
