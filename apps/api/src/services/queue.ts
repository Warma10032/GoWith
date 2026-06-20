import { Queue, type ConnectionOptions } from "bullmq";
import type { Kysely } from "kysely";
import {
  findActivePipelineRun,
  findActiveTaskWithLock,
  type ActivePipelineRun,
  type ActiveTask,
  type DB,
  type Json,
  type TaskLockKey,
} from "@gowith/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";

export type JobName =
  | "check_bilibili_auth_pool"
  | "sync_creator_profile"
  | "sync_creator_videos"
  | "process_video"
  | "run_asr"
  | "classify_video"
  | "extract_comment_signals"
  | "structure_video"
  | "match_poi";

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

type PipelineRunType =
  | "creator_video_sync"
  | "creator_profile_sync"
  | "bilibili_auth_check"
  | "video_processing"
  | "video_asr_retry"
  | "video_ai_retry"
  | "poi_match";

interface PipelineRunInput {
  runType: PipelineRunType;
  entityType: string;
  entityId: string;
  triggeredBy: string;
  summary?: Record<string, unknown>;
}

function taskAlreadyRunningError(key: TaskLockKey, active: ActiveTask) {
  return new HttpError(
    409,
    "task_already_running",
    `Task '${key.jobType}' is already ${active.status} for ${key.entityType}:${key.entityId}`,
    {
      active_job_id: active.id,
      active_run_id: active.run_id,
      status: active.status,
      created_at: active.created_at,
      started_at: active.started_at,
    },
  );
}

function runAlreadyRunningError(
  input: PipelineRunInput,
  active: ActivePipelineRun,
) {
  return new HttpError(
    409,
    "task_already_running",
    `Task '${input.runType}' is already ${active.status} for ${input.entityType}:${input.entityId}`,
    {
      active_run_id: active.id,
      status: active.status,
      created_at: active.created_at,
      started_at: active.started_at,
    },
  );
}

export async function enqueuePipelineRunJob(
  db: Kysely<DB>,
  runInput: PipelineRunInput,
  jobName: JobName,
  payload: Record<string, unknown> = {},
) {
  const key = {
    jobType: jobName,
    entityType: runInput.entityType,
    entityId: runInput.entityId,
  };
  const prepared = await db.transaction().execute(async (trx) => {
    const active = await findActiveTaskWithLock(trx, key);
    if (active) throw taskAlreadyRunningError(key, active);
    const activeRun = await findActivePipelineRun(trx, runInput);
    if (activeRun) throw runAlreadyRunningError(runInput, activeRun);

    const run = await trx
      .insertInto("pipeline_runs")
      .values({
        run_type: runInput.runType,
        entity_type: runInput.entityType,
        entity_id: runInput.entityId,
        status: "queued",
        triggered_by: runInput.triggeredBy,
        started_at: null,
        finished_at: null,
        summary_json: runInput.summary ?? {},
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const jobPayload = { run_id: run.id, ...payload };
    const dbJob = await trx
      .insertInto("jobs")
      .values({
        job_type: jobName,
        entity_type: runInput.entityType,
        entity_id: runInput.entityId,
        run_id: run.id,
        payload: jobPayload as unknown as Json,
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
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("pipeline_events")
      .values({
        run_id: run.id,
        job_id: dbJob.id,
        entity_type: runInput.entityType,
        entity_id: runInput.entityId,
        stage: jobName,
        event_type: "queued",
        level: "info",
        title: `任务已入队：${jobName}`,
        message: null,
        progress_percent: 0,
        detail_json: {
          job_type: jobName,
          payload: jobPayload,
        } as unknown as Json,
        ai_run_id: null,
        created_at: new Date(),
      })
      .execute();

    return { run, dbJobId: dbJob.id, jobPayload };
  });

  const job = await pipelineQueue.add(
    jobName,
    {
      entityType: runInput.entityType,
      entityId: runInput.entityId,
      db_job_id: prepared.dbJobId,
      ...prepared.jobPayload,
    },
    { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  );

  return { run: prepared.run, job };
}
