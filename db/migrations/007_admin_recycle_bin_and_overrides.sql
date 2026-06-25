ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS name_override text,
  ADD COLUMN IF NOT EXISTS bio_override text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS deletion_batch_id uuid;

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS title_override text,
  ADD COLUMN IF NOT EXISTS description_override text,
  ADD COLUMN IF NOT EXISTS tags_override text[],
  ADD COLUMN IF NOT EXISTS category_override text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS deletion_batch_id uuid;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS deletion_batch_id uuid;

CREATE INDEX IF NOT EXISTS creators_active_created_idx
  ON creators (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS creators_deleted_at_idx
  ON creators (deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS videos_active_creator_published_idx
  ON videos (creator_id, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS videos_deleted_at_idx
  ON videos (deleted_at DESC) WHERE deleted_at IS NOT NULL;

DROP INDEX IF EXISTS shops_published_idx;
CREATE INDEX shops_published_idx
  ON shops (published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS shops_deleted_at_idx
  ON shops (deleted_at DESC) WHERE deleted_at IS NOT NULL;
