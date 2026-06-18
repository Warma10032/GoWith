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
    const result = await handlePipelineJob(db, job);
    console.log(`[worker] done ${job.name} ${job.id}`);
    return result;
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
