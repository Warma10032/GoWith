import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "./env";

function redisConnectionOptions(value: string): ConnectionOptions {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

export const connection = redisConnectionOptions(env.redisUrl);
export const pipelineQueue = new Queue("gowith-pipeline", { connection });
