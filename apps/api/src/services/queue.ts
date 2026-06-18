import { Queue, type ConnectionOptions } from "bullmq";
import type { Kysely } from "kysely";
import type { DB, Json } from "@gowith/db";
import { env } from "../lib/env";

export type JobName =
  | "check_bilibili_auth_pool"
  | "sync_creator_profile"
  | "sync_creator_videos"
  | "fetch_video_metadata"
  | "fetch_subtitle"
  | "fetch_comments"
  | "run_asr"
  | "classify_video"
  | "extract_shop_candidates"
  | "extract_comment_signals"
  | "structure_video"
  | "match_poi"
  | "generate_review_tasks"
  | "publish_shop_snapshot";

function redisConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

const connection = redisConnectionOptions(env.redisUrl);
export const pipelineQueue = new Queue("gowith-pipeline", { connection });

export async function enqueuePipelineJob(
  db: Kysely<DB>,
  jobName: JobName,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> = {},
) {
  await db
    .insertInto("jobs")
    .values({
      job_type: jobName,
      entity_type: entityType,
      entity_id: entityId,
      payload: payload as Json,
      status: "queued",
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      scheduled_at: new Date(),
      started_at: null,
      finished_at: null,
      error_code: null,
      error_message: null,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();

  return pipelineQueue.add(jobName, { entityType, entityId, ...payload }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
}
