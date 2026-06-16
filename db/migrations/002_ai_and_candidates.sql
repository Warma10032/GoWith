CREATE TABLE IF NOT EXISTS video_text_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('subtitle', 'asr')),
  language text,
  content_text text NOT NULL,
  content_sha256 text NOT NULL,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_provider text,
  model_name text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
  error_message text,
  object_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_text_assets_video_idx ON video_text_assets (video_id, source);
CREATE UNIQUE INDEX IF NOT EXISTS video_text_assets_hash_uidx ON video_text_assets (video_id, source, content_sha256);

DROP TRIGGER IF EXISTS video_text_assets_set_updated_at ON video_text_assets;
CREATE TRIGGER video_text_assets_set_updated_at BEFORE UPDATE ON video_text_assets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS video_text_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES video_text_assets(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  segment_index integer NOT NULL,
  start_sec numeric(10,3),
  end_sec numeric(10,3),
  text text NOT NULL,
  confidence numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_text_segments_asset_idx ON video_text_segments (asset_id, segment_index);
CREATE INDEX IF NOT EXISTS video_text_segments_video_time_idx ON video_text_segments (video_id, start_sec);
CREATE INDEX IF NOT EXISTS video_text_segments_text_trgm_idx ON video_text_segments USING GIN (text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS video_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  platform_comment_id text NOT NULL,
  parent_comment_id text,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  user_hash text,
  like_count integer,
  reply_count integer,
  published_at timestamptz,
  sample_type text NOT NULL CHECK (sample_type IN ('hot', 'latest', 'keyword')),
  contains_location_signal boolean NOT NULL DEFAULT false,
  contains_shop_signal boolean NOT NULL DEFAULT false,
  raw_payload_id uuid REFERENCES raw_ingest_payloads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS video_comments_platform_uidx ON video_comments (platform_comment_id);
CREATE INDEX IF NOT EXISTS video_comments_video_sample_idx ON video_comments (video_id, sample_type, like_count DESC);
CREATE INDEX IF NOT EXISTS video_comments_signal_idx ON video_comments (video_id) WHERE contains_location_signal OR contains_shop_signal;
CREATE INDEX IF NOT EXISTS video_comments_content_trgm_idx ON video_comments USING GIN (content gin_trgm_ops);

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb,
  raw_output_text text,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'invalid_json', 'schema_error')),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_runs_entity_idx ON ai_runs (entity_type, entity_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_status_idx ON ai_runs (status, stage);
CREATE INDEX IF NOT EXISTS ai_runs_input_hash_idx ON ai_runs (stage, input_hash);

CREATE TABLE IF NOT EXISTS video_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  ai_run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  is_shop_visit boolean NOT NULL,
  content_type text NOT NULL,
  confidence numeric(4,3) NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  need_manual_review boolean NOT NULL DEFAULT false,
  evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_classifications_video_idx ON video_classifications (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_classifications_need_review_idx ON video_classifications (need_manual_review) WHERE need_manual_review;

CREATE TABLE IF NOT EXISTS comment_signal_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  ai_run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  sample_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  shop_name_mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  address_mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status_mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  aspect_sentiments jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comment_signal_video_idx ON comment_signal_extractions (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comment_signal_risk_gin_idx ON comment_signal_extractions USING GIN (risk_flags);

CREATE TABLE IF NOT EXISTS ai_video_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  ai_run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  schema_version text NOT NULL,
  analysis_json jsonb NOT NULL,
  overall_summary text,
  analysis_confidence numeric(4,3),
  shop_candidate_count integer NOT NULL DEFAULT 0,
  risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  validation_status text NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'needs_review')),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_video_analyses_video_idx ON ai_video_analyses (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_video_analyses_validation_idx ON ai_video_analyses (validation_status);
CREATE INDEX IF NOT EXISTS ai_video_analyses_json_gin_idx ON ai_video_analyses USING GIN (analysis_json);

CREATE TABLE IF NOT EXISTS shop_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  ai_video_analysis_id uuid REFERENCES ai_video_analyses(id) ON DELETE SET NULL,
  candidate_name text,
  normalized_name text,
  alias_names text[] NOT NULL DEFAULT '{}'::text[],
  candidate_type text NOT NULL DEFAULT 'unknown' CHECK (candidate_type IN ('physical_shop', 'unknown', 'not_shop')),
  category_primary text,
  category_secondary text,
  province text,
  city text,
  district text,
  business_area text,
  address_hint text,
  landmarks text[] NOT NULL DEFAULT '{}'::text[],
  time_start_sec numeric(10,3),
  time_end_sec numeric(10,3),
  name_confidence numeric(4,3),
  location_confidence numeric(4,3),
  summary_confidence numeric(4,3),
  card_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_fields text[] NOT NULL DEFAULT '{}'::text[],
  risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'extracted',
  selected_poi_id uuid,
  merged_shop_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_candidates_video_idx ON shop_candidates (video_id);
CREATE INDEX IF NOT EXISTS shop_candidates_creator_idx ON shop_candidates (creator_id);
CREATE INDEX IF NOT EXISTS shop_candidates_status_idx ON shop_candidates (status);
CREATE INDEX IF NOT EXISTS shop_candidates_city_idx ON shop_candidates (city, district);
CREATE INDEX IF NOT EXISTS shop_candidates_name_trgm_idx ON shop_candidates USING GIN (candidate_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shop_candidates_risk_gin_idx ON shop_candidates USING GIN (risk_flags);

DROP TRIGGER IF EXISTS shop_candidates_set_updated_at ON shop_candidates;
CREATE TRIGGER shop_candidates_set_updated_at BEFORE UPDATE ON shop_candidates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE,
  shop_candidate_id uuid REFERENCES shop_candidates(id) ON DELETE CASCADE,
  shop_id uuid,
  source text NOT NULL,
  source_ref_id text,
  text_excerpt text NOT NULL,
  start_sec numeric(10,3),
  end_sec numeric(10,3),
  confidence numeric(4,3),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_video_idx ON evidence (video_id);
CREATE INDEX IF NOT EXISTS evidence_candidate_idx ON evidence (shop_candidate_id);
CREATE INDEX IF NOT EXISTS evidence_shop_idx ON evidence (shop_id);
CREATE INDEX IF NOT EXISTS evidence_source_idx ON evidence (source);

