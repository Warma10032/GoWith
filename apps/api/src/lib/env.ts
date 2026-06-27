import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

// 用 import.meta.url 锚定源文件位置，而不是 cwd —— 这样无论
// `pnpm dev`（concurrently，从 monorepo 根启动）还是 `pnpm dev:api`
// （从 apps/api 启动）都能解析到同一个 uploads 目录。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({
  path: path.resolve(__dirname, "..", "..", "..", "..", ".env"),
  override: false,
});

const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PRODUCTION = NODE_ENV === "production";

/**
 * 在生产环境显式拒绝的 dev 默认值。任何引用 dev fallback 的密钥在
 * NODE_ENV=production 下出现都会直接 fail-fast，避免生产误用公开默认值。
 */
const DEV_ONLY_AUTH_SECRET = "dev-only-auth-secret-change-me";
const DEV_ONLY_COOKIE_KEY = "dev-only-cookie-key-change-me";
const PLACEHOLDER_SECRET_VALUES = new Set([
  "replace-with-at-least-32-random-bytes",
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
  if (value === devFallback) {
    if (IS_PRODUCTION) {
      throw new Error(
        `[env] ${name} is using the dev default value; refusing to start in production.`,
      );
    }
    return value;
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

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    if (IS_PRODUCTION) {
      throw new Error("[env] DATABASE_URL is required in production.");
    }
    return "postgres://gowith:gowith@localhost:15432/gowith";
  }
  return value;
}

function requireRedisUrl(): string {
  const value = process.env.REDIS_URL;
  if (!value) {
    if (IS_PRODUCTION) {
      throw new Error("[env] REDIS_URL is required in production.");
    }
    return "redis://localhost:16379";
  }
  return value;
}

export const env = {
  nodeEnv: NODE_ENV,
  isProduction: IS_PRODUCTION,
  port: Number(process.env.PORT ?? 14000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:13000",
  redisUrl: requireRedisUrl(),
  databaseUrl: requireDatabaseUrl(),
  authSecret: requireStrongSecret(
    "AUTH_SECRET",
    process.env.AUTH_SECRET,
    DEV_ONLY_AUTH_SECRET,
    32,
  ),
  cookieEncryptionKey: requireStrongSecret(
    "COOKIE_ENCRYPTION_KEY",
    process.env.COOKIE_ENCRYPTION_KEY,
    DEV_ONLY_COOKIE_KEY,
    32,
  ),
  // worker 写入、本 API 静态 serve 的目录；默认 = apps/api/uploads/，
  // 与 apps/worker/src/env.ts 默认值一致，与启动方式无关。
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, "..", "..", "uploads"),
  // AI Worker 内部鉴权 shared secret：生产环境强制要求，dev 可缺省（mock 模式）。
  aiWorkerSharedSecret: process.env.AI_WORKER_SHARED_SECRET ?? "",
  // 后台 CSRF：生产环境强制开启；dev 允许显式关闭。
  csrfProtectionEnabled: IS_PRODUCTION
    ? true
    : (process.env.CSRF_PROTECTION_ENABLED ?? "false") === "true",
  // 登录限速：每 IP / 每邮箱窗口内最大尝试次数与锁定时长。
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5),
  loginRateLimitWindowMs: Number(
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000,
  ),
  loginLockoutMs: Number(process.env.LOGIN_LOCKOUT_MS ?? 30 * 60 * 1000),
  // 后台 session 有效期（小时）。生产收紧到 12h，dev 保持 30d。
  sessionTtlHours: Number(
    process.env.SESSION_TTL_HOURS ?? (IS_PRODUCTION ? 12 : 24 * 30),
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
