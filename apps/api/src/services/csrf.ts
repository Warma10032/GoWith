/**
 * 双提交 cookie 模式的 CSRF 防护。
 *
 * 设计：
 * - 登录成功后下发一个随机 CSRF token 同时写 cookie (gowith_csrf) 与响应体
 * - cookie 走 SameSite=Lax（与 session 同步），但前端必须显式读取并加到
 *   `X-CSRF-Token` 请求头。攻击者站点无法读取 cookie 即无法伪造头
 * - 服务端只做合法性校验（base64url 32 字节 + 与存储比对），
 *   校验失败统一返回 403 csrf_token_invalid
 * - stateful token 存 Redis，键 `csrf:<sid>`，TTL 12h（与 session 同步）
 * - 关闭开关：env.csrfProtectionEnabled = false 时所有方法都放过
 *
 * 适用接口：所有非 GET / HEAD / OPTIONS 的 /api/admin/** 与 /api/auth/logout
 * 由路由层在 preHandler 中调用 `assertCsrfToken(request, reply)`。
 */

import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";

export const csrfCookieName = "gowith_csrf";
export const csrfHeaderName = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface CsrfTokenRecord {
  token: string;
  expiresAt: number;
}

const inMemoryTokens = new Map<string, CsrfTokenRecord>();

function tokenKey(sessionId: string): string {
  return `csrf:${sessionId}`;
}

export interface CsrfStore {
  get(sessionId: string): Promise<string | null>;
  set(sessionId: string, token: string, ttlSeconds: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

class RedisCsrfStore implements CsrfStore {
  constructor(private readonly redis: Redis) {}

  async get(sessionId: string): Promise<string | null> {
    return this.redis.get(tokenKey(sessionId));
  }

  async set(sessionId: string, token: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(tokenKey(sessionId), token, "EX", ttlSeconds);
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(tokenKey(sessionId));
  }
}

class InMemoryCsrfStore implements CsrfStore {
  async get(sessionId: string): Promise<string | null> {
    const record = inMemoryTokens.get(sessionId);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      inMemoryTokens.delete(sessionId);
      return null;
    }
    return record.token;
  }

  async set(sessionId: string, token: string, ttlSeconds: number): Promise<void> {
    inMemoryTokens.set(sessionId, {
      token,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(sessionId: string): Promise<void> {
    inMemoryTokens.delete(sessionId);
  }
}

let defaultStore: CsrfStore | null = null;

export function configureCsrfStore(store: CsrfStore): void {
  defaultStore = store;
}

export function buildCsrfStore(redis: Redis | null | undefined): CsrfStore {
  if (redis) {
    return new RedisCsrfStore(redis);
  }
  return new InMemoryCsrfStore();
}

function getStore(): CsrfStore {
  if (!defaultStore) {
    defaultStore = new InMemoryCsrfStore();
  }
  return defaultStore;
}

const CSRF_TTL_SECONDS = 12 * 60 * 60; // 与 session TTL 对齐

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function issueCsrfToken(
  sessionId: string,
): Promise<{ token: string; ttlSeconds: number }> {
  const token = generateCsrfToken();
  const ttlSeconds = CSRF_TTL_SECONDS;
  await getStore().set(sessionId, token, ttlSeconds);
  return { token, ttlSeconds };
}

export async function getStoredCsrfToken(sessionId: string): Promise<string | null> {
  return getStore().get(sessionId);
}

export async function revokeCsrfToken(sessionId: string): Promise<void> {
  await getStore().delete(sessionId);
}

/**
 * 在响应上设置 CSRF cookie（前端读取该值并加到 X-CSRF-Token 头）。
 * SameSite=Lax + 非 httpOnly 是双提交 cookie 模式的标准做法。
 */
export function setCsrfCookie(reply: FastifyReply, token: string) {
  reply.setCookie(csrfCookieName, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: CSRF_TTL_SECONDS,
  });
}

export function clearCsrfCookie(reply: FastifyReply) {
  reply.clearCookie(csrfCookieName, { path: "/" });
}

/**
 * 计算当前请求所属会话 ID：优先用 session cookie 值（未登录则用 IP+UA 的稳定 hash）。
 * 这样即使匿名调用也能防止跨站请求，但不能跨 IP 共享。
 */
function getSessionIdForRequest(request: FastifyRequest): string {
  const sessionToken = request.cookies["gowith_session"];
  if (sessionToken && sessionToken.length > 0) {
    return sessionToken;
  }
  const ip = request.ip ?? "anon";
  const ua = request.headers["user-agent"] ?? "anon";
  return `anon:${crypto.createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 16)}`;
}

function extractTokenFromHeader(request: FastifyRequest): string | null {
  const value = request.headers[csrfHeaderName];
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? null;
  return null;
}

/**
 * 校验当前请求是否带合法 CSRF token。关闭开关或 safe method 直接放行。
 * 失败统一抛 403 csrf_token_invalid，不泄露是 cookie / header 哪一边的问题。
 */
export async function assertCsrfToken(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!env.csrfProtectionEnabled) return;
  if (SAFE_METHODS.has(request.method)) return;
  const sessionId = getSessionIdForRequest(request);
  const stored = await getStoredCsrfToken(sessionId);
  if (!stored) {
    throw new HttpError(403, "csrf_token_missing", "CSRF token required");
  }
  const presented = extractTokenFromHeader(request);
  if (!presented) {
    throw new HttpError(403, "csrf_token_invalid", "CSRF token invalid");
  }
  const expected = Buffer.from(stored);
  const actual = Buffer.from(presented);
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    throw new HttpError(403, "csrf_token_invalid", "CSRF token invalid");
  }
}
