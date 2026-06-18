const externalMode = process.env.EXTERNAL_MODE ?? "mock";

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const env = {
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  cookieEncryptionKey: process.env.COOKIE_ENCRYPTION_KEY ?? "dev-only-cookie-key-change-me",
  externalMode,
  isExternalLive: externalMode === "real" || externalMode === "live",
  aiWorkerUrl: process.env.AI_WORKER_URL ?? "http://localhost:8000",
  bilibiliRequestIntervalMs: numberFromEnv("BILIBILI_REQUEST_INTERVAL_MS", 1200),
  bilibiliCommentsLimitPerVideo: numberFromEnv("BILIBILI_COMMENTS_LIMIT_PER_VIDEO", 80),
  bilibiliMaxVideosPerCreator: numberFromEnv("BILIBILI_MAX_VIDEOS_PER_CREATOR", 0),
  bilibiliAsrEnabled: booleanFromEnv("BILIBILI_ASR_ENABLED", true),
  bilibiliCreatorProfileRefreshMs: numberFromEnv("BILIBILI_CREATOR_PROFILE_REFRESH_MS", 6 * 60 * 60 * 1000),
  bilibiliCookieHealthCheckMs: numberFromEnv("BILIBILI_COOKIE_HEALTH_CHECK_MS", 30 * 60 * 1000),
  bilibiliCookieExpiredRetentionDays: numberFromEnv("BILIBILI_COOKIE_EXPIRED_RETENTION_DAYS", 30),
};
