import type { Kysely } from "kysely";
import {
  findActivePipelineRun,
  findActiveTaskWithLock,
  SYSTEM_TASK_ENTITY_ID,
  type DB,
  type Json,
} from "@gowith/db";
import { scheduledTaskDefinitions } from "@gowith/shared";
import { pipelineQueue } from "./queue";
import { env } from "./env";

type Timer = ReturnType<typeof setInterval>;

async function enqueueCreatorProfileRefreshes(database: Kysely<DB>) {
  const creators = await database
    .selectFrom("creators")
    .select(["id", "bilibili_uid"])
    .where("status", "=", "active")
    .where("deleted_at", "is", null)
    .orderBy("updated_at", "asc")
    .limit(100)
    .execute();

  for (const creator of creators) {
    const payload = {
      entityType: "creator",
      entityId: creator.id,
      bilibili_uid: creator.bilibili_uid,
    };
    const dbJob = await database.transaction().execute(async (trx) => {
      const active = await findActiveTaskWithLock(trx, {
        jobType: "sync_creator_profile",
        entityType: "creator",
        entityId: creator.id,
      });
      if (active) return null;

      return trx
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
        .returning(["id"])
        .executeTakeFirstOrThrow();
    });
    if (!dbJob) continue;
    await pipelineQueue.add(
      "sync_creator_profile",
      { ...payload, db_job_id: dbJob.id },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
  return creators.length;
}

async function enqueueScheduledTask(
  database: Kysely<DB>,
  task: (typeof scheduledTaskDefinitions)[number],
) {
  const payload = {
    scheduled_task_id: task.id,
    retentionDays: task.retentionDays,
  };
  const prepared = await database.transaction().execute(async (trx) => {
    const active = await findActiveTaskWithLock(trx, {
      jobType: task.jobName,
      entityType: "system",
      entityId: SYSTEM_TASK_ENTITY_ID,
    });
    if (active) return null;
    const activeRun = await findActivePipelineRun(trx, {
      runType: task.runType,
      entityType: "system",
      entityId: SYSTEM_TASK_ENTITY_ID,
    });
    if (activeRun) return null;

    const run = await trx
      .insertInto("pipeline_runs")
      .values({
        run_type: task.runType,
        entity_type: "system",
        entity_id: SYSTEM_TASK_ENTITY_ID,
        status: "queued",
        triggered_by: null,
        started_at: null,
        finished_at: null,
        summary_json: {
          scheduled_task_id: task.id,
          trigger: "schedule",
          retention_days: task.retentionDays ?? null,
        } as unknown as Json,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const dbJob = await trx
      .insertInto("jobs")
      .values({
        job_type: task.jobName,
        entity_type: "system",
        entity_id: SYSTEM_TASK_ENTITY_ID,
        run_id: run.id,
        payload: { run_id: run.id, ...payload } as unknown as Json,
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
        entity_type: "system",
        entity_id: SYSTEM_TASK_ENTITY_ID,
        stage: task.jobName,
        event_type: "queued",
        level: "info",
        title: `定时任务已入队：${task.name}`,
        message: null,
        progress_percent: 0,
        detail_json: {
          scheduled_task_id: task.id,
          job_type: task.jobName,
        } as unknown as Json,
        ai_run_id: null,
        created_at: new Date(),
      })
      .execute();

    return { run, dbJob };
  });

  if (!prepared) return false;
  await pipelineQueue.add(
    task.jobName,
    {
      entityType: "system",
      entityId: SYSTEM_TASK_ENTITY_ID,
      db_job_id: prepared.dbJob.id,
      run_id: prepared.run.id,
      ...payload,
    },
    { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  );
  return true;
}

function startFixedInterval(
  label: string,
  intervalMs: number,
  action: () => Promise<unknown>,
) {
  void action().catch((error) =>
    console.error(`[worker:scheduler] ${label} failed`, error),
  );
  return setInterval(() => {
    void action().catch((error) =>
      console.error(`[worker:scheduler] ${label} failed`, error),
    );
  }, intervalMs);
}

export function startScheduler(database: Kysely<DB>) {
  const timers: Timer[] = [];

  if (env.bilibiliCreatorProfileRefreshMs > 0) {
    timers.push(
      startFixedInterval(
        "creator_profile_refresh",
        env.bilibiliCreatorProfileRefreshMs,
        async () => {
          const count = await enqueueCreatorProfileRefreshes(database);
          console.log(`[worker:scheduler] queued ${count} creator profile jobs`);
        },
      ),
    );
  }

  for (const task of scheduledTaskDefinitions) {
    if (!task.enabled) continue;
    timers.push(
      startFixedInterval(task.id, task.intervalMs, async () => {
        const queued = await enqueueScheduledTask(database, task);
        console.log(
          `[worker:scheduler] ${queued ? "queued" : "skipped"} ${task.id}`,
        );
      }),
    );
  }

  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
    },
  };
}
