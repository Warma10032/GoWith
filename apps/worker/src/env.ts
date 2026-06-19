import path from "node:path";
import { fileURLToPath } from "node:url";

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

// 用 import.meta.url 锚定源文件位置，而不是 cwd —— 这样无论
// `pnpm dev`（concurrently，从 monorepo 根启动）还是 `pnpm dev:worker`
// （从 apps/worker 启动）都能解析到同一个 uploads 目录。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const env = {
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  cookieEncryptionKey:
    process.env.COOKIE_ENCRYPTION_KEY ?? "dev-only-cookie-key-change-me",
  aiWorkerUrl: process.env.AI_WORKER_URL ?? "http://localhost:8000",
  amapWebServiceKey: process.env.AMAP_WEB_SERVICE_KEY ?? "",
  // 图片下载到本地的目录；与 apps/api 共享，让 @fastify/static 直接 serve。
  // 默认 = apps/api/uploads/，与 apps/api/src/lib/env.ts 默认值一致，
  // 与启动方式无关。
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, "..", "..", "..", "api", "uploads"),
  bilibiliRequestIntervalMs: numberFromEnv(
    "BILIBILI_REQUEST_INTERVAL_MS",
    1200,
  ),
  bilibiliCommentsLimitPerVideo: numberFromEnv(
    "BILIBILI_COMMENTS_LIMIT_PER_VIDEO",
    80,
  ),
  bilibiliMaxVideosPerCreator: numberFromEnv(
    "BILIBILI_MAX_VIDEOS_PER_CREATOR",
    0,
  ),
  bilibiliAsrEnabled: booleanFromEnv("BILIBILI_ASR_ENABLED", true),
  bilibiliCreatorProfileRefreshMs: numberFromEnv(
    "BILIBILI_CREATOR_PROFILE_REFRESH_MS",
    6 * 60 * 60 * 1000,
  ),
  bilibiliCookieHealthCheckMs: numberFromEnv(
    "BILIBILI_COOKIE_HEALTH_CHECK_MS",
    30 * 60 * 1000,
  ),
  bilibiliCookieExpiredRetentionDays: numberFromEnv(
    "BILIBILI_COOKIE_EXPIRED_RETENTION_DAYS",
    30,
  ),
};
