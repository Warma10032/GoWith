import type { Job } from "bullmq";
import { sql, type Kysely } from "kysely";
import type { DB, Json } from "@gowith/db";

const TERMINAL_JOB_STATUSES = ["success", "failed", "cancelled"] as const;

function daysFromJob(job: Job, fallback: number) {
  const value = Number((job.data as { retentionDays?: unknown }).retentionDays);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cutoffDate(retentionDays: number) {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

function runIdFromJob(job: Job) {
  return typeof job.data?.run_id === "string" ? job.data.run_id : null;
}

async function updateRunSummary(
  db: Kysely<DB>,
  job: Job,
  summary: Record<string, unknown>,
) {
  const runId = runIdFromJob(job);
  if (!runId) return;
  await db
    .updateTable("pipeline_runs")
    .set({ summary_json: summary as Json })
    .where("id", "=", runId)
    .execute();
}

export async function cleanupAiRunsJob(db: Kysely<DB>, job: Job) {
  const retentionDays = daysFromJob(job, 30);
  const cutoff = cutoffDate(retentionDays);

  const oldRows = await db
    .selectFrom("ai_runs")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("created_at", "<", cutoff)
    .executeTakeFirst();
  const oldCount = Number(oldRows?.count ?? 0);

  const deleted = await sql<{ id: string }>`
    delete from ai_runs ar
    where ar.created_at < ${cutoff}
      and not exists (
        select 1 from ai_runs child where child.parent_ai_run_id = ar.id
      )
      and not exists (
        select 1 from video_classifications vc where vc.ai_run_id = ar.id
      )
      and not exists (
        select 1 from comment_signal_extractions cse where cse.ai_run_id = ar.id
      )
      and not exists (
        select 1 from ai_video_analyses ava where ava.ai_run_id = ar.id
      )
    returning ar.id
  `.execute(db);

  const deletedCount = deleted.rows.length;
  const summary = {
    scheduled_task_id: "cleanup_ai_runs",
    retention_days: retentionDays,
    cutoff_at: cutoff.toISOString(),
    old_count: oldCount,
    deleted_count: deletedCount,
    protected_count: Math.max(0, oldCount - deletedCount),
  };
  await updateRunSummary(db, job, summary);
  return summary;
}

export async function cleanupTaskLogsJob(db: Kysely<DB>, job: Job) {
  const retentionDays = daysFromJob(job, 7);
  const cutoff = cutoffDate(retentionDays);

  const eventRows = await sql<{ count: string | number }>`
    select count(*) as count
    from pipeline_events pe
    inner join pipeline_runs pr on pr.id = pe.run_id
    where pr.status in (${sql.join([...TERMINAL_JOB_STATUSES])})
      and coalesce(pr.finished_at, pr.updated_at, pr.created_at) < ${cutoff}
  `.execute(db);
  const pipelineEventsDeleted = Number(eventRows.rows[0]?.count ?? 0);

  const jobs = await sql<{ id: string }>`
    delete from jobs
    where status in (${sql.join([...TERMINAL_JOB_STATUSES])})
      and coalesce(finished_at, updated_at, created_at) < ${cutoff}
    returning id
  `.execute(db);

  const runs = await sql<{ id: string }>`
    delete from pipeline_runs
    where status in (${sql.join([...TERMINAL_JOB_STATUSES])})
      and coalesce(finished_at, updated_at, created_at) < ${cutoff}
    returning id
  `.execute(db);

  const summary = {
    scheduled_task_id: "cleanup_task_logs",
    retention_days: retentionDays,
    cutoff_at: cutoff.toISOString(),
    jobs_deleted: jobs.rows.length,
    pipeline_runs_deleted: runs.rows.length,
    pipeline_events_deleted: pipelineEventsDeleted,
  };
  await updateRunSummary(db, job, summary);
  return summary;
}
