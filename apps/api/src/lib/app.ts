import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { createDb } from "@gowith/db";
import { env } from "./env";
import { sendError } from "./http";
import { registerAuthRoutes } from "../routes/auth";
import { registerAdminRoutes } from "../routes/admin";
import { registerPublicRoutes } from "../routes/public";

export function buildApp() {
  const app = Fastify({ logger: true });
  const db = createDb();

  app.decorate("db", db);

  app.register(cors, {
    origin: [env.webOrigin, "http://localhost:3000"],
    credentials: true,
  });
  app.register(cookie);
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

  app.get("/health", async () => ({ ok: true, service: "api" }));

  app.register(registerAuthRoutes, { prefix: "/api/auth" });
  app.register(registerAdminRoutes, { prefix: "/api/admin" });
  app.register(registerPublicRoutes, { prefix: "/api" });

  app.addHook("onClose", async () => {
    await db.destroy();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>;
  }
}

