import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { loginRequestSchema } from "@gowith/shared";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";
import {
  clearSessionCookie,
  getRequestClientIp,
  getUserFromRequest,
  loginWithPassword,
  revokeSession,
  sanitizeUser,
  setSessionCookie,
  sessionCookieName,
} from "../services/auth";
import {
  assertCsrfToken,
  clearCsrfCookie,
  issueCsrfToken,
  setCsrfCookie,
} from "../services/csrf";
import {
  checkRateLimit,
  clearRateLimit,
} from "../services/rate-limit";

function rateLimitExceeded(reply: FastifyReply, retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  reply.header("Retry-After", String(seconds));
  throw new HttpError(
    429,
    "rate_limited",
    `Too many login attempts; retry after ${seconds}s`,
  );
}

export const registerAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const ip = getRequestClientIp(request);

    // P0-2: 登录限速。先校验 IP 维度的锁定，再校验 email 维度的锁定。
    const ipLimit = await checkRateLimit({
      scope: "login_ip",
      key: ip,
      max: env.loginRateLimitMax,
      windowMs: env.loginRateLimitWindowMs,
      lockoutMs: env.loginLockoutMs,
    });
    if (!ipLimit.allowed) rateLimitExceeded(reply, ipLimit.retryAfterMs);

    const emailLimit = await checkRateLimit({
      scope: "login_email",
      key: email,
      max: env.loginRateLimitMax,
      windowMs: env.loginRateLimitWindowMs,
      lockoutMs: env.loginLockoutMs,
    });
    if (!emailLimit.allowed) rateLimitExceeded(reply, emailLimit.retryAfterMs);

    const { token, expiresAt, user } = await loginWithPassword(
      app.db,
      email,
      body.password,
      request,
    );
    // 登录成功：清除限速状态，避免锁定好的用户反复被锁。
    await clearRateLimit("login_ip", ip);
    await clearRateLimit("login_email", email);
    setSessionCookie(reply, token, expiresAt);
    // P0-3: 签发 CSRF token 并写入 cookie。
    const csrf = await issueCsrfToken(token);
    setCsrfCookie(reply, csrf.token);
    return { user, csrf_token: csrf.token };
  });

  app.post("/logout", async (request, reply) => {
    // logout 是写操作：必须校验 CSRF（防跨站触发登出使合法 session 失效）
    await assertCsrfToken(request, reply);
    const sessionToken = request.cookies[sessionCookieName];
    await revokeSession(app.db, request);
    if (sessionToken) {
      await clearRateLimit("csrf_session", sessionToken);
    }
    clearSessionCookie(reply);
    clearCsrfCookie(reply);
    return { ok: true };
  });

  app.get("/me", async (request, reply) => {
    const user = await getUserFromRequest(app.db, request);
    // 如果已登录但还没有 CSRF token（如 session 早于 CSRF 部署时签发），
    // 顺手补发，保证前端一定有可用的 token。
    if (user) {
      const sessionToken = request.cookies[sessionCookieName];
      if (sessionToken) {
        const csrf = await issueCsrfToken(sessionToken);
        setCsrfCookie(reply, csrf.token);
        return { user: sanitizeUser(user), csrf_token: csrf.token };
      }
    }
    return { user: user ? sanitizeUser(user) : null };
  });
};
