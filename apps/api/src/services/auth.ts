import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { DB, User } from "@gowith/db";
import { HttpError } from "../lib/http";
import { env } from "../lib/env";
import { hashToken } from "./crypto";

export const sessionCookieName = "gowith_session";
// SESSION_TTL_HOURS 控制，dev 默认 30d，生产收紧到 12h。
const sessionHours = env.sessionTtlHours;

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return request.ip ?? "unknown";
}

function hashClientField(value: string): string {
  // 与 crypto.ts 同样的密钥派生，保证 hashToken 与设备指纹使用同一密钥源。
  return crypto
    .createHash("sha256")
    .update(`${env.authSecret}:client:${value}`)
    .digest("hex")
    .slice(0, 32);
}

export async function loginWithPassword(
  db: Kysely<DB>,
  email: string,
  password: string,
  request: FastifyRequest,
) {
  const user = await db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", email)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (!user?.password_hash) {
    // 同样的"账号不存在 / 密码错"反馈，避免用户名枚举
    throw new HttpError(401, "invalid_credentials", "Invalid email or password");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, "invalid_credentials", "Invalid email or password");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);
  const ipHash = hashClientField(getClientIp(request));
  const userAgent = request.headers["user-agent"] ?? null;
  const userAgentHash = userAgent ? hashClientField(userAgent) : null;

  await db
    .insertInto("auth_sessions")
    .values({
      id: crypto.randomUUID(),
      user_id: user.id,
      session_token_hash: tokenHash,
      client_type: "web",
      ip_hash: ipHash,
      user_agent: userAgentHash,
      expires_at: expiresAt,
      revoked_at: null,
      created_at: new Date(),
    })
    .execute();

  await db
    .updateTable("users")
    .set({ last_login_at: new Date() })
    .where("id", "=", user.id)
    .execute();

  return { token, expiresAt, user: sanitizeUser(user) };
}

export async function getUserFromRequest(
  db: Kysely<DB>,
  request: FastifyRequest,
) {
  const token = request.cookies[sessionCookieName];
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const session = await db
    .selectFrom("auth_sessions")
    .innerJoin("users", "users.id", "auth_sessions.user_id")
    .select([
      "users.id",
      "users.email",
      "users.phone",
      "users.username",
      "users.display_name",
      "users.avatar_url",
      "users.avatar_source_url",
      "users.role",
      "users.status",
      "users.password_hash",
      "users.last_login_at",
      "users.created_at",
      "users.updated_at",
    ])
    .where("auth_sessions.session_token_hash", "=", tokenHash)
    .where("auth_sessions.revoked_at", "is", null)
    .where("auth_sessions.expires_at", ">", new Date())
    .executeTakeFirst();

  return session ?? null;
}

export async function revokeSession(db: Kysely<DB>, request: FastifyRequest) {
  const token = request.cookies[sessionCookieName];
  if (!token) return;

  await db
    .updateTable("auth_sessions")
    .set({ revoked_at: new Date() })
    .where("session_token_hash", "=", hashToken(token))
    .execute();
}

export async function requireUser(db: Kysely<DB>, request: FastifyRequest) {
  const user = await getUserFromRequest(db, request);
  if (!user) {
    throw new HttpError(401, "unauthorized", "Login required");
  }
  return user;
}

export async function requireAdmin(db: Kysely<DB>, request: FastifyRequest) {
  const user = await requireUser(db, request);
  if (user.role !== "admin") {
    throw new HttpError(403, "forbidden", "Admin access required");
  }
  return user;
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(sessionCookieName, token, {
    httpOnly: true,
    // 生产必须 secure；CSRF 由 csrf 插件单独防护（P0-3）。
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(sessionCookieName, { path: "/" });
}

export function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    avatar_source_url: user.avatar_source_url,
    role: user.role,
    status: user.status,
  };
}

export function getRequestClientIp(request: FastifyRequest): string {
  return getClientIp(request);
}
