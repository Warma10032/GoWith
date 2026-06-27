import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createDb } from "@gowith/db";
import { env } from "./env";
import { closeRedis, getRedis } from "./redis";
import { sendError } from "./http";
import { configureCsrfStore, buildCsrfStore } from "../services/csrf";
import {
  configureRateLimitStore,
  buildRateLimitStore,
} from "../services/rate-limit";
import { registerAuthRoutes } from "../routes/auth";
import { registerAdminRoutes } from "../routes/admin";
import { registerPublicRoutes } from "../routes/public";
import { TaskEventBroker } from "../services/task-events";

export function buildApp() {
  const app = Fastify({ logger: true });
  const db = createDb();
  const taskEvents = new TaskEventBroker();

  app.decorate("db", db);
  app.decorate("taskEvents", taskEvents);
  void taskEvents.start().catch((error: unknown) => {
    app.log.error({ error }, "task event broker failed to start");
  });

  // P0-2/P0-3: 共享 Redis 客户端连接到限速 + CSRF 存储。
  // 先配置 InMemory fallback；Redis 连接成功后再切换到 Redis store。
  const redis = getRedis();
  configureRateLimitStore(buildRateLimitStore(null));
  configureCsrfStore(buildCsrfStore(null));
  void redis
    .connect()
    .then(() => {
      configureRateLimitStore(buildRateLimitStore(redis));
      configureCsrfStore(buildCsrfStore(redis));
    })
    .catch((err: unknown) => {
      app.log.warn(
        { err },
        "redis unavailable, rate-limit/CSRF will use in-memory fallback",
      );
    });

  // P2-3: helmet 给 API 自身一份安全头（HSTS / nosniff / frameguard 等）。
  // CSP 设为相对宽松，因为这是 API；反代 / Web 端会覆盖更严格的策略。
  app.register(helmet, {
    contentSecurityPolicy: env.isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  });

  // 显式 CORS 白名单：拒绝不在白名单的 Origin 写回 ACAO。
  const allowedOrigins = Array.from(
    new Set([
      env.webOrigin,
      "http://localhost:13000",
      "http://127.0.0.1:13000",
    ]),
  );
  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  app.register(cookie);

  // 上传目录静态服务：worker 把第三方图片下载到 env.uploadsDir，
  // DB 存 /uploads/<kind>/<file>，前端通过 14000 端口直接拉。
  // 用 prefix "/uploads" 避免和 /api 路由冲突；cacheControl 走 1 天。
  const uploadsRoot = path.isAbsolute(env.uploadsDir)
    ? env.uploadsDir
    : path.resolve(process.cwd(), env.uploadsDir);
  app.register(staticFiles, {
    root: uploadsRoot,
    prefix: "/uploads/",
    serve: true,
    cacheControl: true,
    maxAge: 60 * 60 * 24,
    decorateReply: false,
  });

  // P1-2: Swagger UI 在生产环境不注册，避免枚举所有内部接口。
  if (!env.isProduction) {
    void Promise.all([
      import("@fastify/swagger"),
      import("@fastify/swagger-ui"),
    ]).then(([swagger, swaggerUi]) => {
      app.register(swagger.default, {
        openapi: { info: { title: "GoWith API", version: "0.1.0" } },
      });
      app.register(swaggerUi.default, { routePrefix: "/docs" });
    });
  }

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));

  void fs.mkdir(uploadsRoot, { recursive: true }).catch((err: unknown) => {
    app.log.warn(
      { err, uploadsRoot },
      "无法创建 uploads 目录，图片上传可能失败",
    );
  });

  app.get("/health", async () => ({ ok: true, service: "api" }));

  app.register(registerAuthRoutes, { prefix: "/api/auth" });
  app.register(registerAdminRoutes, { prefix: "/api/admin" });
  app.register(registerPublicRoutes, { prefix: "/api" });

  app.addHook("onClose", async () => {
    await taskEvents.stop();
    await closeRedis();
    await db.destroy();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>;
    taskEvents: TaskEventBroker;
  }
}
