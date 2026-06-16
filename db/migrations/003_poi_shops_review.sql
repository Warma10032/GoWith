CREATE TABLE IF NOT EXISTS pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('amap', 'tencent', 'baidu')),
  provider_poi_id text NOT NULL,
  name text NOT NULL,
  address text,
  province text,
  city text,
  district text,
  business_area text,
  category text,
  category_code text,
  lng numeric(10,6) NOT NULL,
  lat numeric(10,6) NOT NULL,
  coord_type text NOT NULL CHECK (coord_type IN ('gcj02', 'bd09', 'wgs84')),
  geom geometry(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)
  ) STORED,
  phone text,
  business_hours text,
  raw_payload_id uuid REFERENCES raw_ingest_payloads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pois_provider_uidx ON pois (provider, provider_poi_id);
CREATE INDEX IF NOT EXISTS pois_city_category_idx ON pois (city, district, category);
CREATE INDEX IF NOT EXISTS pois_name_trgm_idx ON pois USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pois_geom_gix ON pois USING GIST (geom);

DROP TRIGGER IF EXISTS pois_set_updated_at ON pois;
CREATE TRIGGER pois_set_updated_at BEFORE UPDATE ON pois
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS poi_match_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_candidate_id uuid NOT NULL REFERENCES shop_candidates(id) ON DELETE CASCADE,
  provider text NOT NULL,
  query_strategy text NOT NULL,
  query_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'no_candidate')),
  raw_payload_id uuid REFERENCES raw_ingest_payloads(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poi_match_attempts_candidate_idx ON poi_match_attempts (shop_candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS poi_match_attempts_provider_idx ON poi_match_attempts (provider, status);

CREATE TABLE IF NOT EXISTS poi_match_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES poi_match_attempts(id) ON DELETE CASCADE,
  shop_candidate_id uuid NOT NULL REFERENCES shop_candidates(id) ON DELETE CASCADE,
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  match_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_score numeric(5,4) NOT NULL,
  match_status text NOT NULL DEFAULT 'candidate' CHECK (match_status IN ('candidate', 'selected', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poi_match_candidates_candidate_idx ON poi_match_candidates (shop_candidate_id, match_score DESC);
CREATE INDEX IF NOT EXISTS poi_match_candidates_attempt_idx ON poi_match_candidates (attempt_id, rank);
CREATE INDEX IF NOT EXISTS poi_match_candidates_poi_idx ON poi_match_candidates (poi_id);

CREATE TABLE IF NOT EXISTS shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_poi_id uuid NOT NULL REFERENCES pois(id),
  canonical_name text NOT NULL,
  display_name text NOT NULL,
  category_primary text,
  category_secondary text,
  province text,
  city text,
  district text,
  business_area text,
  address text,
  lng numeric(10,6) NOT NULL,
  lat numeric(10,6) NOT NULL,
  coord_type text NOT NULL CHECK (coord_type IN ('gcj02', 'bd09', 'wgs84')),
  geom geometry(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)
  ) STORED,
  avg_price_hint text,
  card_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  aggregated_review jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shops_status_city_idx ON shops (status, city, district);
CREATE INDEX IF NOT EXISTS shops_category_idx ON shops (category_primary, category_secondary);
CREATE INDEX IF NOT EXISTS shops_name_trgm_idx ON shops USING GIN (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shops_geom_gix ON shops USING GIST (geom);
CREATE INDEX IF NOT EXISTS shops_published_idx ON shops (published_at DESC) WHERE status = 'published';

DROP TRIGGER IF EXISTS shops_set_updated_at ON shops;
CREATE TRIGGER shops_set_updated_at BEFORE UPDATE ON shops
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE shop_candidates
  ADD CONSTRAINT shop_candidates_selected_poi_fk
  FOREIGN KEY (selected_poi_id) REFERENCES pois(id) ON DELETE SET NULL;

ALTER TABLE shop_candidates
  ADD CONSTRAINT shop_candidates_merged_shop_fk
  FOREIGN KEY (merged_shop_id) REFERENCES shops(id) ON DELETE SET NULL;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_shop_fk
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS shop_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  source text NOT NULL,
  confidence numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_aliases_shop_idx ON shop_aliases (shop_id);
CREATE INDEX IF NOT EXISTS shop_aliases_name_trgm_idx ON shop_aliases USING GIN (alias_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS shop_video_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shop_candidate_id uuid REFERENCES shop_candidates(id) ON DELETE SET NULL,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  mention_type text NOT NULL DEFAULT 'main',
  sentiment text NOT NULL DEFAULT 'unknown',
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  time_start_sec numeric(10,3),
  time_end_sec numeric(10,3),
  summary text,
  evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_video_mentions_unique_idx ON shop_video_mentions (shop_id, video_id, mention_type);
CREATE INDEX IF NOT EXISTS shop_video_mentions_shop_idx ON shop_video_mentions (shop_id);
CREATE INDEX IF NOT EXISTS shop_video_mentions_creator_idx ON shop_video_mentions (creator_id, video_id);
CREATE INDEX IF NOT EXISTS shop_video_mentions_video_idx ON shop_video_mentions (video_id);

CREATE TABLE IF NOT EXISTS shop_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  sentiment text NOT NULL DEFAULT 'unknown',
  summary text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  source_type text NOT NULL,
  source_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  model_version text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_insights_shop_dimension_idx ON shop_insights (shop_id, dimension, status);
CREATE INDEX IF NOT EXISTS shop_insights_sentiment_idx ON shop_insights (dimension, sentiment);

DROP TRIGGER IF EXISTS shop_insights_set_updated_at ON shop_insights;
CREATE TRIGGER shop_insights_set_updated_at BEFORE UPDATE ON shop_insights
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS published_shop_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot_json jsonb NOT NULL,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS published_shop_snapshots_current_uidx ON published_shop_snapshots (shop_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS published_shop_snapshots_shop_version_idx ON published_shop_snapshots (shop_id, version DESC);

CREATE TABLE IF NOT EXISTS review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'rejected', 'cancelled')),
  risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_tasks_status_priority_idx ON review_tasks (status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS review_tasks_entity_idx ON review_tasks (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS review_tasks_risk_gin_idx ON review_tasks USING GIN (risk_flags);

DROP TRIGGER IF EXISTS review_tasks_set_updated_at ON review_tasks;
CREATE TRIGGER review_tasks_set_updated_at BEFORE UPDATE ON review_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_task_id uuid REFERENCES review_tasks(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  reason text,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_events_entity_idx ON review_events (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS review_events_task_idx ON review_events (review_task_id, created_at DESC);

