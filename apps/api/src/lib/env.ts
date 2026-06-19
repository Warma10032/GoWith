import path from "node:path";
import { fileURLToPath } from "node:url";

// 用 import.meta.url 锚定源文件位置，而不是 cwd —— 这样无论
// `pnpm dev`（concurrently，从 monorepo 根启动）还是 `pnpm dev:api`
// （从 apps/api 启动）都能解析到同一个 uploads 目录。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const env = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  authSecret: process.env.AUTH_SECRET ?? "dev-only-auth-secret-change-me",
  cookieEncryptionKey:
    process.env.COOKIE_ENCRYPTION_KEY ?? "dev-only-cookie-key-change-me",
  // worker 写入、本 API 静态 serve 的目录；默认 = apps/api/uploads/，
  // 与 apps/worker/src/env.ts 默认值一致，与启动方式无关。
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, "..", "..", "uploads"),
};
