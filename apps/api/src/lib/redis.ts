/**
 * 共享 ioredis 客户端：限速、CSRF token 等非 BullMQ 用途共用同一连接。
 *
 * BullMQ 自带的 Queue 连接对象不暴露出来，所以这里单开一个 lazy 客户端，
 * 用 env.redisUrl 解析 host/port/password。模块 import 时不会真正连接，
 * 只有第一次调用 getRedis() 才会建立 socket，单元测试不依赖 Redis 时
 * 也不会启动连接。
 */
import IORedis, { type Redis } from "ioredis";
import { env } from "./env";

let client: Redis | null = null;

function buildClient(): Redis {
  const url = new URL(env.redisUrl);
  return new IORedis({
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    // BullMQ 推荐关闭此处的自动重连错误抛出，避免阻塞 Fastify 启动。
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
}

export function getRedis(): Redis {
  if (!client) {
    client = buildClient();
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
