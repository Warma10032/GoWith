export const env = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  authSecret: process.env.AUTH_SECRET ?? "dev-only-auth-secret-change-me",
  cookieEncryptionKey:
    process.env.COOKIE_ENCRYPTION_KEY ?? "dev-only-cookie-key-change-me",
  // worker 写入、本 API 静态 serve 的目录；与 worker env.UPLOADS_DIR 共享。
  uploadsDir: process.env.UPLOADS_DIR ?? "./uploads",
};
