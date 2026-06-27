/**
 * 基于 Redis 的固定窗口限速器 + 失败计数锁定。
 *
 * 用途：
 * - 登录接口的 IP / email 维度限速与失败锁定（P0-2）
 * - 埋点接口的 IP / anonymous_id 维度限速（P1-4）
 * - 任何其它需要"窗口内限速 + 锁定窗口"语义的接口
 *
 * 设计：
 * - 用 INCR + EXPIRE 维护计数；超过 max 后进入锁定状态
 * - 锁定期内所有匹配 key 的请求一律拒绝
 * - 计数 key 包含 ip / email / anonymous_id 等可组合维度
 * - Redis 不可用时使用进程内 fallback（dev 友好；生产应监控）
 */

import type { Redis } from "ioredis";

export interface RateLimitOptions {
  /** 维度前缀，例如 "login" / "events" */
  scope: string;
  /** 维度键，例如 email、ip、anonymous_id */
  key: string;
  /** 窗口内最大允许次数 */
  max: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 超过 max 后的锁定时长（毫秒） */
  lockoutMs: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** 当前窗口内累计次数（包含本次） */
  count: number;
  /** 距窗口重置的剩余毫秒数 */
  retryAfterMs: number;
  /** 处于锁定状态时返回锁定剩余毫秒数；否则 0 */
  lockoutMs: number;
}

interface CounterState {
  count: number;
  resetAt: number;
}

const inMemory = new Map<string, CounterState>();
const lockouts = new Map<string, number>();

/**
 * rate-limit 存储抽象。生产环境走 Redis；dev / 测试可注入 memory 实现。
 */
export interface RateLimitStore {
  incr(scope: string, key: string, windowMs: number): Promise<number>;
  ttl(scope: string, key: string): Promise<number>;
  setLock(scope: string, key: string, lockoutMs: number): Promise<void>;
  isLocked(scope: string, key: string): Promise<number>;
  clearLock(scope: string, key: string): Promise<void>;
  clearCounters(scope: string, key: string): Promise<void>;
}

class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  private counterKey(scope: string, key: string) {
    return `rl:counter:${scope}:${key}`;
  }

  private lockKey(scope: string, key: string) {
    return `rl:lock:${scope}:${key}`;
  }

  async incr(scope: string, key: string, windowMs: number): Promise<number> {
    const counterKey = this.counterKey(scope, key);
    const seconds = Math.max(1, Math.ceil(windowMs / 1000));
    const count = await this.redis.incr(counterKey);
    if (count === 1) {
      await this.redis.expire(counterKey, seconds);
    }
    return count;
  }

  async ttl(scope: string, key: string): Promise<number> {
    const ttl = await this.redis.ttl(this.counterKey(scope, key));
    return ttl > 0 ? ttl * 1000 : 0;
  }

  async setLock(scope: string, key: string, lockoutMs: number): Promise<void> {
    const lockKey = this.lockKey(scope, key);
    const seconds = Math.max(1, Math.ceil(lockoutMs / 1000));
    await this.redis.set(lockKey, "1", "EX", seconds);
  }

  async isLocked(scope: string, key: string): Promise<number> {
    const ttl = await this.redis.ttl(this.lockKey(scope, key));
    return ttl > 0 ? ttl * 1000 : 0;
  }

  async clearLock(scope: string, key: string): Promise<void> {
    await this.redis.del(this.lockKey(scope, key));
  }

  async clearCounters(scope: string, key: string): Promise<void> {
    await this.redis.del(this.counterKey(scope, key));
  }
}

class InMemoryRateLimitStore implements RateLimitStore {
  async incr(scope: string, key: string, windowMs: number): Promise<number> {
    const fullKey = `${scope}:${key}`;
    const now = Date.now();
    const state = inMemory.get(fullKey);
    if (!state || state.resetAt <= now) {
      inMemory.set(fullKey, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    state.count += 1;
    return state.count;
  }

  async ttl(scope: string, key: string): Promise<number> {
    const state = inMemory.get(`${scope}:${key}`);
    if (!state) return 0;
    const remaining = state.resetAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  async setLock(scope: string, key: string, lockoutMs: number): Promise<void> {
    lockouts.set(`${scope}:${key}`, Date.now() + lockoutMs);
  }

  async isLocked(scope: string, key: string): Promise<number> {
    const expiresAt = lockouts.get(`${scope}:${key}`);
    if (!expiresAt) return 0;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      lockouts.delete(`${scope}:${key}`);
      return 0;
    }
    return remaining;
  }

  async clearLock(scope: string, key: string): Promise<void> {
    lockouts.delete(`${scope}:${key}`);
  }

  async clearCounters(scope: string, key: string): Promise<void> {
    inMemory.delete(`${scope}:${key}`);
  }
}

let defaultStore: RateLimitStore | null = null;

export function configureRateLimitStore(store: RateLimitStore): void {
  defaultStore = store;
}

export function buildRateLimitStore(
  redis: Redis | null | undefined,
): RateLimitStore {
  if (redis) {
    return new RedisRateLimitStore(redis);
  }
  return new InMemoryRateLimitStore();
}

function getStore(): RateLimitStore {
  if (!defaultStore) {
    defaultStore = new InMemoryRateLimitStore();
  }
  return defaultStore;
}

export async function checkRateLimit(
  options: RateLimitOptions,
): Promise<RateLimitVerdict> {
  const store = getStore();
  const lockMs = await store.isLocked(options.scope, options.key);
  if (lockMs > 0) {
    return {
      allowed: false,
      count: 0,
      retryAfterMs: lockMs,
      lockoutMs: lockMs,
    };
  }
  const count = await store.incr(options.scope, options.key, options.windowMs);
  if (count > options.max) {
    await store.setLock(options.scope, options.key, options.lockoutMs);
    return {
      allowed: false,
      count,
      retryAfterMs: options.lockoutMs,
      lockoutMs: options.lockoutMs,
    };
  }
  const retryAfterMs = await store.ttl(options.scope, options.key);
  return { allowed: true, count, retryAfterMs, lockoutMs: 0 };
}

export async function recordFailure(
  scope: string,
  key: string,
  lockoutMs: number,
): Promise<void> {
  const store = getStore();
  await store.setLock(scope, key, lockoutMs);
}

export async function clearRateLimit(
  scope: string,
  key: string,
): Promise<void> {
  const store = getStore();
  await store.clearCounters(scope, key);
  await store.clearLock(scope, key);
}
