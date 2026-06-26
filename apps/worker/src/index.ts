import { Worker } from "bullmq";
import crypto from "node:crypto";
import {
  createDb,
  type Json,
} from "@gowith/db";
import { connection, pipelineQueue } from "./queue";
import { handlePipelineJob } from "./jobs/pipeline";
import { startScheduler } from "./scheduler";

const db = createDb();
const scheduler = startScheduler(db);

const worker = new Worker(
  "gowith-pipeline",
  async (job) => {
    console.log(`[worker] start ${job.name} ${job.id}`);
    const dbJobId =
      typeof job.data?.db_job_id === "string" ? job.data.db_job_id : null;
    const runId = typeof job.data?.run_id === "string" ? job.data.run_id : null;
    const entityType =
      typeof job.data?.entityType === "string"
        ? job.data.entityType
        : "unknown";
    const entityId =
      typeof job.data?.entityId === "string"
        ? job.data.entityId
        : crypto.randomUUID();
    if (dbJobId) {
      await db
        .updateTable("jobs")
        .set({
          status: "running",
          started_at: new Date(),
          attempts: job.attemptsMade + 1,
        })
        .where("id", "=", dbJobId)
        .execute();
    }
    if (runId) {
      await db
        .updateTable("pipeline_runs")
        .set({ status: "running", started_at: new Date() })
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
        await db
          .updateTable("jobs")
          .set({ status: "success", finished_at: new Date() })
          .where("id", "=", dbJobId)
          .execute();
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
          .set({
            status: "failed",
            finished_at: new Date(),
            error_code: "worker_error",
            error_message: message,
          })
          .where("id", "=", dbJobId)
          .execute();
      }
      if (runId) {
        await db
          .updateTable("pipeline_runs")
          .set({
            status: "failed",
            finished_at: new Date(),
            summary_json: { error_message: message } as unknown as Json,
          })
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
  scheduler.stop();
  await worker.close();
  await pipelineQueue.close();
  await db.destroy();
  process.exit(0);
});

console.log("[worker] GoWith pipeline worker is running");
