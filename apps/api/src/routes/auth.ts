import type { FastifyPluginAsync } from "fastify";
import { loginRequestSchema } from "@gowith/shared";
import {
  clearSessionCookie,
  getUserFromRequest,
  loginWithPassword,
  revokeSession,
  sanitizeUser,
  setSessionCookie,
} from "../services/auth";

export const registerAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);
    const { token, expiresAt, user } = await loginWithPassword(app.db, body.email, body.password);
    setSessionCookie(reply, token, expiresAt);
    return { user };
  });

  app.post("/logout", async (request, reply) => {
    await revokeSession(app.db, request);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/me", async (request) => {
    const user = await getUserFromRequest(app.db, request);
    return { user: user ? sanitizeUser(user) : null };
  });
};

