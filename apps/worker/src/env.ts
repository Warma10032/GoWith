import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PRODUCTION = NODE_ENV === "production";
const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");

function envFilePath(): string {
  if (process.env.ENV_FILE) return path.resolve(ROOT_DIR, process.env.ENV_FILE);
  return path.resolve(ROOT_DIR, `.env.${NODE_ENV}`);
}

dotenvConfig({ path: envFilePath(), override: false });
dotenvConfig({ path: path.resolve(ROOT_DIR, ".env"), override: false });

const DEV_ONLY_COOKIE_KEY = "dev-only-cookie-key-change-me";
const PLACEHOLDER_SECRET_VALUES = new Set([
  "replace-with-32-byte-base64-key",
  "replace-with-32-byte-shared-secret",
]);

function requireStrongSecret(
  name: string,
  value: string | undefined,
  devFallback: string,
  minLength: number,
): string {
  if (!value) {
    if (IS_PRODUCTION) {
      throw new Error(
        `[env] ${name} is required in production. Set it via secrets manager / Docker secret.`,
      );
    }
    return devFallback;
  }
  if (value === devFallback && IS_PRODUCTION) {
    throw new Error(
      `[env] ${name} is using the dev default value; refusing to start in production.`,
    );
  }
  if (IS_PRODUCTION && PLACEHOLDER_SECRET_VALUES.has(value)) {
    throw new Error(
      `[env] ${name} is using a public placeholder value; refusing to start in production.`,
    );
  }
  if (value.length < minLength && IS_PRODUCTION) {
    throw new Error(
      `[env] ${name} must be at least ${minLength} chars (got ${value.length}) in production.`,
    );
  }
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[env] ${name} is required.`);
  return value;
}

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
export const env = {
  nodeEnv: NODE_ENV,
  isProduction: IS_PRODUCTION,
  redisUrl: requireEnv("REDIS_URL"),
  databaseUrl: requireEnv("DATABASE_URL"),
  cookieEncryptionKey: requireStrongSecret(
    "COOKIE_ENCRYPTION_KEY",
    process.env.COOKIE_ENCRYPTION_KEY,
    DEV_ONLY_COOKIE_KEY,
    32,
  ),
  aiWorkerUrl: requireEnv("AI_WORKER_URL"),
  // Worker 调用 AI Worker 时的内部 shared secret。
  // 生产环境强制要求与 AI Worker 端保持一致；dev 缺省为空（mock 模式）。
  aiWorkerSharedSecret: process.env.AI_WORKER_SHARED_SECRET ?? "",
  amapWebServiceKey: process.env.AMAP_WEB_SERVICE_KEY ?? "",
  // 图片下载到本地的目录；与 apps/api 共享，让 @fastify/static 直接 serve。
  // 默认 = apps/api/uploads/，与 apps/api/src/lib/env.ts 默认值一致，
  // 与启动方式无关。
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, "..", "..", "..", "api", "uploads"),
  // P0-6: 图片下载白名单域名（逗号分隔）。空数组 = 允许任何公网域名。
  imageDownloadAllowedDomains: (
    process.env.IMAGE_DOWNLOAD_ALLOWED_DOMAINS ?? ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  // P0-6: 是否拒绝任何内网 / 环回 / metadata IP。生产必须 true。
  imageDownloadBlockPrivateNetworks:
    (process.env.IMAGE_DOWNLOAD_BLOCK_PRIVATE_NETWORKS ??
      (IS_PRODUCTION ? "true" : "false")) === "true",
  bilibiliRequestIntervalMs: numberFromEnv(
    "BILIBILI_REQUEST_INTERVAL_MS",
    1200,
  ),
  bilibiliRateLimitCooldownMs: numberFromEnv(
    "BILIBILI_RATE_LIMIT_COOLDOWN_MS",
    60_000,
  ),
  bilibiliMaxRequestIntervalMs: numberFromEnv(
    "BILIBILI_MAX_REQUEST_INTERVAL_MS",
    15_000,
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

// 启动时立刻校验 AI Worker 鉴权：生产环境必须配置 shared secret。
if (IS_PRODUCTION && !env.aiWorkerSharedSecret) {
  throw new Error(
    "[env] AI_WORKER_SHARED_SECRET is required in production (AI worker internal auth).",
  );
}
if (IS_PRODUCTION && PLACEHOLDER_SECRET_VALUES.has(env.aiWorkerSharedSecret)) {
  throw new Error(
    "[env] AI_WORKER_SHARED_SECRET is using a public placeholder value; refusing to start in production.",
  );
}
