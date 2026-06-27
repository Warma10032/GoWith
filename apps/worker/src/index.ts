import { Worker } from "bullmq";
import crypto from "node:crypto";
import { createDb, type Json } from "@gowith/db";
import { connection, pipelineQueue } from "./queue";
import { handlePipelineJob } from "./jobs/pipeline";
import { startScheduler } from "./scheduler";
import { BilibiliError } from "./adapters/bilibili";

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
      const pipelineStatus =
        result &&
        typeof result === "object" &&
        "pipeline_status" in result &&
        result.pipeline_status === "failed"
          ? "failed"
          : "success";
      if (dbJobId) {
        await db
          .updateTable("jobs")
          .set({
            status: pipelineStatus,
            finished_at: new Date(),
            error_code: pipelineStatus === "failed" ? "partial_failure" : null,
            error_message:
              pipelineStatus === "failed"
                ? "Task completed with item-level failures"
                : null,
          })
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
            event_type: pipelineStatus === "failed" ? "failed" : "completed",
            level: pipelineStatus === "failed" ? "warning" : "success",
            title:
              pipelineStatus === "failed"
                ? `任务完成但存在失败项：${job.name}`
                : `完成任务：${job.name}`,
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
      const errorCode =
        error instanceof BilibiliError ? error.code : "worker_error";
      const retryable =
        errorCode === "rate_limited" ||
        errorCode === "risk_control" ||
        errorCode === "network_error" ||
        errorCode === "wbi_signature_failed";
      if (!retryable) job.discard();
      const maxAttempts =
        typeof job.opts.attempts === "number" && job.opts.attempts > 0
          ? job.opts.attempts
          : 1;
      const attemptNumber = job.attemptsMade + 1;
      const willRetry = retryable && attemptNumber < maxAttempts;
      if (dbJobId) {
        await db
          .updateTable("jobs")
          .set({
            status: willRetry ? "queued" : "failed",
            finished_at: willRetry ? null : new Date(),
            error_code: errorCode,
            error_message: message,
          })
          .where("id", "=", dbJobId)
          .execute();
      }
      if (runId) {
        if (!willRetry) {
          await db
            .updateTable("pipeline_runs")
            .set({
              status: "failed",
              finished_at: new Date(),
              summary_json: {
                error_code: errorCode,
                error_message: message,
              } as unknown as Json,
            })
            .where("id", "=", runId)
            .execute();
        }
        await db
          .insertInto("pipeline_events")
          .values({
            run_id: runId,
            job_id: dbJobId,
            entity_type: entityType,
            entity_id: entityId,
            stage: job.name,
            event_type: willRetry ? "progress" : "failed",
            level: willRetry ? "warning" : "error",
            title: willRetry
              ? `任务失败，等待自动重试：${job.name}`
              : `任务失败：${job.name}`,
            message,
            progress_percent: null,
            detail_json: {
              error_code: errorCode,
              attempt: attemptNumber,
              max_attempts: maxAttempts,
              will_retry: willRetry,
            } as unknown as Json,
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
