import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createDb } from "@gowith/db";
import { env } from "./env";
import { sendError } from "./http";
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

  app.register(cors, {
    origin: [
      env.webOrigin,
      // Docker compose 把 web 映射到宿主机 3170（3000 在 Windows 保留段）。
      "http://localhost:3170",
      // 本机直跑 next dev（pnpm dev:web）时的默认端口，保留兼容。
      "http://localhost:3000",
      "http://127.0.0.1:8765",
      "http://localhost:8765",
    ],
    credentials: true,
  });
  app.register(cookie);

  // 上传目录静态服务：worker 把第三方图片下载到 env.uploadsDir，
  // DB 存 /uploads/<kind>/<file>，前端通过 4000 端口直接拉。
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

  app.register(swagger, {
    openapi: {
      info: {
        title: "GoWith API",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));

  // 启动时确保上传目录存在；否则 worker 写入会 ENOENT。
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
