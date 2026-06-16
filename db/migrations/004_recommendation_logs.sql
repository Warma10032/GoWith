CREATE TABLE IF NOT EXISTS creator_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_follows_unique_idx ON creator_follows (user_id, creator_id);
CREATE INDEX IF NOT EXISTS creator_follows_creator_idx ON creator_follows (creator_id);

CREATE TABLE IF NOT EXISTS user_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('favorite', 'want_to_go', 'visited')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_favorites_unique_idx ON user_favorites (user_id, shop_id, action_type);
CREATE INDEX IF NOT EXISTS user_favorites_shop_idx ON user_favorites (shop_id, action_type);

DROP TRIGGER IF EXISTS user_favorites_set_updated_at ON user_favorites;
CREATE TRIGGER user_favorites_set_updated_at BEFORE UPDATE ON user_favorites
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS recommendation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  anonymous_id text,
  surface text NOT NULL,
  request_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  algorithm text NOT NULL DEFAULT 'rule_v0',
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendation_requests_user_idx ON recommendation_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recommendation_requests_surface_idx ON recommendation_requests (surface, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES recommendation_requests(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  score numeric(10,6) NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  feature_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS recommendation_items_unique_idx ON recommendation_items (request_id, shop_id);
CREATE INDEX IF NOT EXISTS recommendation_items_shop_idx ON recommendation_items (shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  anonymous_id text,
  event_name text NOT NULL,
  entity_type text,
  entity_id uuid,
  shop_id uuid REFERENCES shops(id) ON DELETE SET NULL,
  creator_id uuid REFERENCES creators(id) ON DELETE SET NULL,
  video_id uuid REFERENCES videos(id) ON DELETE SET NULL,
  recommendation_request_id uuid REFERENCES recommendation_requests(id) ON DELETE SET NULL,
  recommendation_item_id uuid REFERENCES recommendation_items(id) ON DELETE SET NULL,
  surface text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_type text NOT NULL DEFAULT 'web' CHECK (client_type IN ('web', 'miniapp', 'app')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_events_user_time_idx ON user_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_anon_time_idx ON user_events (anonymous_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_name_time_idx ON user_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_shop_idx ON user_events (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_reco_idx ON user_events (recommendation_request_id, recommendation_item_id);

