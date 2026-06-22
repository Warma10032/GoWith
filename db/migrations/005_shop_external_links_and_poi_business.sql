ALTER TABLE pois
  ADD COLUMN IF NOT EXISTS rating numeric(3,2),
  ADD COLUMN IF NOT EXISTS avg_cost numeric(10,2),
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS shop_external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('dianping', 'meituan')),
  external_shop_id text,
  external_url text NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'official_api')),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'removed')),
  confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, platform)
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_external_links_platform_shop_uidx
  ON shop_external_links (platform, external_shop_id)
  WHERE external_shop_id IS NOT NULL AND status = 'confirmed';
CREATE INDEX IF NOT EXISTS shop_external_links_shop_status_idx
  ON shop_external_links (shop_id, status);

DROP TRIGGER IF EXISTS shop_external_links_set_updated_at ON shop_external_links;
CREATE TRIGGER shop_external_links_set_updated_at BEFORE UPDATE ON shop_external_links
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
