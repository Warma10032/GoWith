CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone text,
  username text,
  display_name text,
  avatar_url text,
  avatar_source_url text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_hash text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL,
  client_type text NOT NULL DEFAULT 'web' CHECK (client_type IN ('web', 'miniapp', 'app')),
  ip_hash text,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_uidx ON auth_sessions (session_token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS bilibili_auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  encrypted_cookie text NOT NULL,
  csrf_token_encrypted text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'paused', 'risk')),
  last_health_check_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message text,
  rate_limit_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bilibili_auth_accounts_status_idx ON bilibili_auth_accounts (status);

DROP TRIGGER IF EXISTS bilibili_auth_accounts_set_updated_at ON bilibili_auth_accounts;
CREATE TRIGGER bilibili_auth_accounts_set_updated_at BEFORE UPDATE ON bilibili_auth_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS raw_ingest_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  resource_type text NOT NULL,
  resource_key text NOT NULL,
  request_hash text NOT NULL,
  payload jsonb,
  object_key text,
  payload_sha256 text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_ingest_provider_resource_idx ON raw_ingest_payloads (provider, resource_type, resource_key);
CREATE UNIQUE INDEX IF NOT EXISTS raw_ingest_request_hash_uidx ON raw_ingest_payloads (provider, request_hash);

CREATE TABLE IF NOT EXISTS creators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bilibili_uid text NOT NULL,
  name text NOT NULL,
  avatar_url text,
  avatar_source_url text,
  profile_url text NOT NULL,
  bio text,
  follower_count bigint,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  sync_mode text NOT NULL DEFAULT 'full' CHECK (sync_mode IN ('full', 'incremental')),
  last_synced_at timestamptz,
  last_video_published_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload_id uuid REFERENCES raw_ingest_payloads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS creators_bilibili_uid_uidx ON creators (bilibili_uid);
CREATE INDEX IF NOT EXISTS creators_status_idx ON creators (status);
CREATE INDEX IF NOT EXISTS creators_name_trgm_idx ON creators USING GIN (name gin_trgm_ops);

DROP TRIGGER IF EXISTS creators_set_updated_at ON creators;
CREATE TRIGGER creators_set_updated_at BEFORE UPDATE ON creators
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  bvid text NOT NULL,
  aid text,
  cid text,
  title text NOT NULL,
  description text,
  cover_url text,
  cover_source_url text,
  source_url text NOT NULL,
  duration_sec integer,
  published_at timestamptz,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  category text,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  workflow_status text NOT NULL DEFAULT 'new',
  is_shop_visit boolean,
  content_type text,
  classification_confidence numeric(4,3),
  risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  raw_payload_id uuid REFERENCES raw_ingest_payloads(id) ON DELETE SET NULL,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS videos_bvid_uidx ON videos (bvid);
CREATE INDEX IF NOT EXISTS videos_creator_published_idx ON videos (creator_id, published_at DESC);
CREATE INDEX IF NOT EXISTS videos_workflow_status_idx ON videos (workflow_status);
CREATE INDEX IF NOT EXISTS videos_is_shop_visit_idx ON videos (is_shop_visit) WHERE is_shop_visit IS NOT NULL;
CREATE INDEX IF NOT EXISTS videos_title_trgm_idx ON videos USING GIN (title gin_trgm_ops);

DROP TRIGGER IF EXISTS videos_set_updated_at ON videos;
CREATE TRIGGER videos_set_updated_at BEFORE UPDATE ON videos
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN (
    'creator_video_sync',
    'creator_profile_sync',
    'bilibili_auth_check',
    'video_processing',
    'video_asr_retry',
    'video_ai_retry',
    'poi_match'
  )),
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

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  run_id uuid REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (status, priority DESC, scheduled_at);
CREATE INDEX IF NOT EXISTS jobs_entity_idx ON jobs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_type_status_idx ON jobs (job_type, status);
CREATE INDEX IF NOT EXISTS jobs_run_idx ON jobs (run_id, created_at DESC);

DROP TRIGGER IF EXISTS jobs_set_updated_at ON jobs;
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
