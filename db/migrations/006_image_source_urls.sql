-- 006：保存图片的原始第三方 URL（用于回溯、重新下载、CDN 切换）
-- B 站 hdslb.com CDN 默认 Referer 白名单拒绝非 B 站域名直链，
-- 因此 worker 把头像 / 封面下载到 apps/api/uploads/ 后，DB 存的是
-- 本地 /uploads/... 路径，原始 URL 留在这两个列里以便未来重新拉取。

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS avatar_source_url text;

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS cover_source_url text;
