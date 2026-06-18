import { Worker } from "bullmq";
import crypto from "node:crypto";
import type { Kysely } from "kysely";
import { createDb, type DB, type Json } from "@gowith/db";
import { connection, pipelineQueue } from "./queue";
import { handlePipelineJob } from "./jobs/pipeline";
import { env } from "./env";

const db = createDb();

async function enqueueCreatorProfileRefreshes(database: Kysely<DB>) {
  const creators = await database
    .selectFrom("creators")
    .select(["id", "bilibili_uid"])
    .where("status", "=", "active")
    .orderBy("updated_at", "asc")
    .limit(100)
    .execute();

  for (const creator of creators) {
    const payload = { entityType: "creator", entityId: creator.id, bilibili_uid: creator.bilibili_uid };
    await database
      .insertInto("jobs")
      .values({
        job_type: "sync_creator_profile",
        entity_type: "creator",
        entity_id: creator.id,
        run_id: null,
        payload: { bilibili_uid: creator.bilibili_uid } as unknown as Json,
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
    await pipelineQueue.add("sync_creator_profile", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
  return creators.length;
}

async function enqueueBilibiliAuthPoolCheck(database: Kysely<DB>) {
  const entityId = crypto.randomUUID();
  await database
    .insertInto("jobs")
    .values({
      job_type: "check_bilibili_auth_pool",
      entity_type: "system",
      entity_id: entityId,
      run_id: null,
      payload: {} as unknown as Json,
      status: "queued",
      priority: 10,
      attempts: 0,
      max_attempts: 1,
      scheduled_at: new Date(),
      started_at: null,
      finished_at: null,
      error_code: null,
      error_message: null,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  await pipelineQueue.add(
    "check_bilibili_auth_pool",
    { entityType: "system", entityId },
    { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
  );
}

function startCreatorProfileScheduler(database: Kysely<DB>) {
  if (env.bilibiliCreatorProfileRefreshMs <= 0) return null;
  void enqueueCreatorProfileRefreshes(database)
    .then((count) => console.log(`[worker] queued ${count} creator profile refresh jobs`))
    .catch((error) => console.error("[worker] failed to queue creator profile refresh jobs", error));

  return setInterval(() => {
    void enqueueCreatorProfileRefreshes(database)
      .then((count) => console.log(`[worker] queued ${count} creator profile refresh jobs`))
      .catch((error) => console.error("[worker] failed to queue creator profile refresh jobs", error));
  }, env.bilibiliCreatorProfileRefreshMs);
}

const creatorProfileScheduler = startCreatorProfileScheduler(db);

function startBilibiliAuthPoolScheduler(database: Kysely<DB>) {
  if (env.bilibiliCookieHealthCheckMs <= 0) return null;
  void enqueueBilibiliAuthPoolCheck(database).catch((error) => console.error("[worker] failed to queue Bilibili auth pool check", error));
  return setInterval(() => {
    void enqueueBilibiliAuthPoolCheck(database).catch((error) => console.error("[worker] failed to queue Bilibili auth pool check", error));
  }, env.bilibiliCookieHealthCheckMs);
}

const bilibiliAuthPoolScheduler = startBilibiliAuthPoolScheduler(db);

const worker = new Worker(
  "gowith-pipeline",
  async (job) => {
    console.log(`[worker] start ${job.name} ${job.id}`);
    const dbJobId = typeof job.data?.db_job_id === "string" ? job.data.db_job_id : null;
    const runId = typeof job.data?.run_id === "string" ? job.data.run_id : null;
    const entityType = typeof job.data?.entityType === "string" ? job.data.entityType : "unknown";
    const entityId = typeof job.data?.entityId === "string" ? job.data.entityId : crypto.randomUUID();
    if (dbJobId) {
      await db
        .updateTable("jobs")
        .set({ status: "running", started_at: new Date(), attempts: job.attemptsMade + 1 })
        .where("id", "=", dbJobId)
        .execute();
    }
    if (runId) {
      await db.updateTable("pipeline_runs").set({ status: "running", started_at: new Date() }).where("id", "=", runId).execute();
      await db
        .insertInto("pipeline_events")
        .values({
          run_id: runId,
          job_id: dbJobId,
          entity_type: entityType,
          entity_id: entityId,
          stage: job.name,
          event_type: "started",
          level: "info",
          title: `开始执行：${job.name}`,
          message: null,
          progress_percent: null,
          detail_json: { bullmq_job_id: job.id } as unknown as Json,
          ai_run_id: null,
          created_at: new Date(),
        })
        .execute();
    }
    try {
      const result = await handlePipelineJob(db, job);
      if (dbJobId) {
        await db.updateTable("jobs").set({ status: "success", finished_at: new Date() }).where("id", "=", dbJobId).execute();
      }
      if (runId) {
        await db
          .insertInto("pipeline_events")
          .values({
            run_id: runId,
            job_id: dbJobId,
            entity_type: entityType,
            entity_id: entityId,
            stage: job.name,
            event_type: "completed",
            level: "success",
            title: `完成任务：${job.name}`,
            message: null,
            progress_percent: null,
            detail_json: { result } as unknown as Json,
            ai_run_id: null,
            created_at: new Date(),
          })
          .execute();
      }
      console.log(`[worker] done ${job.name} ${job.id}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (dbJobId) {
        await db
          .updateTable("jobs")
          .set({ status: "failed", finished_at: new Date(), error_code: "worker_error", error_message: message })
          .where("id", "=", dbJobId)
          .execute();
      }
      if (runId) {
        await db
          .updateTable("pipeline_runs")
          .set({ status: "failed", finished_at: new Date(), summary_json: { error_message: message } as unknown as Json })
          .where("id", "=", runId)
          .execute();
        await db
          .insertInto("pipeline_events")
          .values({
            run_id: runId,
            job_id: dbJobId,
            entity_type: entityType,
            entity_id: entityId,
            stage: job.name,
            event_type: "failed",
            level: "error",
            title: `任务失败：${job.name}`,
            message,
            progress_percent: null,
            detail_json: {} as unknown as Json,
            ai_run_id: null,
            created_at: new Date(),
          })
          .execute();
      }
      throw error;
    }
  },
  { connection, concurrency: 2 },
);

worker.on("failed", (job, error) => {
  console.error(`[worker] failed ${job?.name} ${job?.id}`, error);
});

process.on("SIGINT", async () => {
  if (creatorProfileScheduler) clearInterval(creatorProfileScheduler);
  if (bilibiliAuthPoolScheduler) clearInterval(bilibiliAuthPoolScheduler);
  await worker.close();
  await pipelineQueue.close();
  await db.destroy();
  process.exit(0);
});

console.log("[worker] GoWith pipeline worker is running");
