-- 007：用户头像也保留原始第三方 URL，避免 auth 查询与 DB schema drift。

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_source_url text;
